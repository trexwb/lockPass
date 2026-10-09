// LockPass — Tauri 内嵌本地 HTTP 服务（仅绑定 127.0.0.1）
//
// 职责：作为内存代理，把前端解锁后同步来的明文条目暴露给浏览器扩展，
// 配合「一键配对」流程完成扩展与桌面端的可信连接。
//
// 接口：
//   GET  /status                  无鉴权，返回 { unlocked, paired }
//   GET  /credentials?domain=xxx  Bearer 鉴权，返回该域名匹配的条目数组
//   POST /pair                    一键配对：生成 nonce 并通知前端弹窗，返回 { nonce }
//   GET  /pair/poll?nonce=xxx     轮询配对结果：{ status: "pending" | "confirmed", token? } / { status: "invalid" }
//   POST /pair/cancel             取消当前待确认的配对（扩展侧取消）
//   POST /capture                 Bearer 鉴权 + 已解锁，登记待确认捕获并把凭据经事件交给前端确认，返回 { id }
//   GET  /capture/status?id=xxx   Bearer 鉴权，轮询用户在桌面端的确认结果
//                                 最多 4 个待确认槽位，按 id 独立回报与一次性领取
//                                 { status: "pending" | "created" | "updated" | "exists" | "error" | "rejected" | "expired" | "invalid" }
//
// 安全说明：
//   - 仅绑定 127.0.0.1 固定端口 33555，不对局域网开放；
//   - /credentials 必须携带 Bearer token，token 由前端解锁后生成、仅存 Rust 内存；
//   - 明文条目仅存内存，lock 后即清空。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 本地服务固定端口（扩展 manifest / background.js 中的 33555 需与此保持一致）
pub const LOCAL_SERVER_PORT: u16 = 33555;

/// 待确认配对的超时时间（秒）
const PAIR_PENDING_TTL_SECS: u64 = 120;

/// 待确认捕获凭据的超时时间（秒）：超时后 Rust 内存中的明文直接丢弃。
/// 需覆盖「浏览器提交 → 切到桌面确认」的跨应用耗时，故放宽到 180s；
/// 扩展后台轮询上限（CAPTURE_DESKTOP_TIMEOUT_MS）须 ≥ 此值，否则后台会先于槽位过期误报失败。
const CAPTURE_PENDING_TTL_SECS: u64 = 180;

/// 同时待确认的捕获槽位上限：超出的新请求挤掉最旧的一个
/// （用户在桌面端逐个确认，多标签页同时点保存才是真实并发）
const MAX_PENDING_CAPTURES: usize = 4;

/// 自定义字段 DTO：与前端 customFields 结构对齐（upgrade-design.md §2.2）
/// 供扩展按 type 匹配 email/phone/otp/url 进行多字段填充
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldDto {
    pub id: String,
    pub label: String,
    pub value: String,
    pub sensitive: bool,
    #[serde(rename = "type")]
    pub field_type: String,
}

/// 条目 DTO：前端解锁后经 IPC 同步进来，字段与前端条目结构对齐（camelCase）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDto {
    pub id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub entry_type: String,
    /// 由前端解析好的主机名（如 github.com）
    pub domain: String,
    /// 自定义字段（缺省为空，兼容旧版前端未传该字段）
    #[serde(default)]
    pub custom_fields: Vec<CustomFieldDto>,
}

#[derive(Debug, Clone, Default)]
struct PendingPair {
    nonce: String,
    token: Option<String>,
    created_at: u64,
}

/// 扩展上报的待确认凭据（POST /capture 的请求体）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePayload {
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    /// 网页 document.title，仅作条目标题展示；宽松清洗而非拒绝（缺省兼容旧扩展）
    #[serde(default)]
    pub title: String,
}

/// 桌面端捕获槽位：只记 id 与确认状态，明文凭据仅经本地 IPC 送给前端，不在 Rust 内存驻留
#[derive(Debug, Clone)]
struct PendingCapture {
    id: String,
    created_at: u64,
    /// pending → created/updated/exists/error/rejected（由前端回报）
    status: String,
}

/// 前端回报的捕获结果白名单（非法值一律拒绝，避免扩展侧误判成功）
fn is_report_status(s: &str) -> bool {
    matches!(s, "created" | "updated" | "exists" | "error" | "rejected")
}

#[derive(Debug, Default)]
pub(crate) struct ServerInner {
    unlocked: bool,
    token: Option<String>,
    entries: Vec<EntryDto>,
    pending_pair: Option<PendingPair>,
    /// 待确认捕获按 id 独立登记（多标签页同时保存不会互相顶掉），按下标即到达顺序
    pending_captures: Vec<PendingCapture>,
}

impl ServerInner {
    /// 丢弃已超时的待确认（pending）槽位；返回本次因超时作废的 id（调用方据此区分 410 与 404）。
    /// 已有终态结果（created/updated/exists/error/rejected）的槽位不按 TTL 丢弃：
    /// 否则用户在 TTL 边缘点「保存」后，结果会在扩展下一次轮询前被清掉，
    /// 扩展收到 410/404 误报「保存失败」，而凭据其实已落盘。终态槽位由轮询一次性领取
    /// 或桌面端锁屏 lock() 清空，数量受 MAX_PENDING_CAPTURES 挤兑约束，不会无限增长。
    fn prune_expired_captures(&mut self, now: u64) -> Vec<String> {
        let mut expired = Vec::new();
        self.pending_captures.retain(|cap| {
            if cap.status != "pending" {
                return true;
            }
            if now.saturating_sub(cap.created_at) > CAPTURE_PENDING_TTL_SECS {
                expired.push(cap.id.clone());
                false
            } else {
                true
            }
        });
        expired
    }

    fn find_capture(&self, id: &str) -> Option<usize> {
        self.pending_captures
            .iter()
            .position(|cap| constant_time_eq(id, &cap.id))
    }
}

/// 线程间共享的服务状态
#[derive(Debug, Clone)]
pub struct ServerState(pub Arc<Mutex<ServerInner>>);

impl ServerState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(ServerInner::default())))
    }

    pub(crate) fn clone_inner(&self) -> Arc<Mutex<ServerInner>> {
        Arc::clone(&self.0)
    }

    /// 前端解锁后标记服务就绪
    pub fn set_ready(&self, unlocked: bool) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
        g.unlocked = unlocked;
        Ok(())
    }

    /// 前端解锁后同步明文条目（内存代理，不落盘）
    pub fn set_entries(&self, entries: Vec<EntryDto>) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
        g.entries = entries;
        Ok(())
    }

    /// 锁定/登出时清空内存中的条目与解锁标记（token 保留，扩展已配对不受影响）
    pub fn lock(&self) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
        g.unlocked = false;
        g.entries.clear();
        g.pending_captures.clear(); // 未确认的捕获一并作废（槽位本就只存 id 与状态）
        Ok(())
    }

    /// 前端回报捕获结果（用户确认保存 / 取消），供扩展轮询领取
    pub fn report_capture(&self, id: &str, status: &str) -> Result<(), String> {
        if !is_report_status(status) {
            eprintln!("[capture] report_capture 拒绝非法状态 status={status} id={id}");
            return Err("非法的捕获结果状态".into());
        }
        let mut g = self.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
        let Some(idx) = g.find_capture(id) else {
            eprintln!("[capture] report_capture 槽位不存在（锁屏清空/已过期/服务重启）id={id}");
            return Err("没有待确认的捕获请求".into());
        };
        eprintln!("[capture] report_capture 已登记 {status} id={id}，等待扩展轮询领取");
        g.pending_captures[idx].status = status.to_string();
        Ok(())
    }

    /// 获取当前待确认配对的 nonce（供前端弹窗查询）
    pub fn get_pending_nonce(&self) -> Result<Option<String>, String> {
        let g = self.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
        Ok(g.pending_pair.as_ref().map(|p| p.nonce.clone()))
    }

    /// 前端点击「允许」：校验 nonce 并发放 token
    pub fn confirm_pair(&self, nonce: &str) -> Result<String, String> {
        let mut g = self.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
        let token = {
            let pair = g
                .pending_pair
                .as_mut()
                .ok_or("没有待确认的配对请求")?;
            if !constant_time_eq(nonce, &pair.nonce) {
                return Err("nonce 不匹配，配对请求已失效".into());
            }
            let token = generate_token();
            pair.token = Some(token.clone());
            token
        };
        g.token = Some(token.clone());
        Ok(token)
    }

    /// 前端点击「拒绝」：清空待确认配对
    pub fn reject_pair(&self, nonce: &str) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
        if let Some(pair) = &g.pending_pair {
            if constant_time_eq(nonce, &pair.nonce) {
                g.pending_pair = None;
            }
        }
        Ok(())
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 生成随机 token（32 字节十六进制）
/// CSPRNG（getrandom / OS 随机源）：token 是扩展鉴权凭据，
/// 不可用时间种子 xorshift 之类的可预测序列替代。
fn generate_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("OS 随机源不可用");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 生成 6 位数字 nonce，方便用户在弹窗中肉眼比对
/// 同样使用 CSPRNG：nonce 虽为肉眼比对设计，仍不应可被预计算
fn generate_nonce() -> String {
    let mut buf = [0u8; 4];
    getrandom::getrandom(&mut buf).expect("OS 随机源不可用");
    let mut state = u32::from_le_bytes(buf);
    let mut out = String::with_capacity(6);
    for _ in 0..6 {
        out.push(char::from(b'0' + (state % 10) as u8));
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
    }
    out
}

/// 生成捕获请求 id（16 字节随机，hex）：扩展据此轮询结果，不可预测以防串号
fn generate_capture_id() -> String {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("OS 随机源不可用");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Bearer token 校验（优先 Authorization 头，兼容旧 query ?token= 兜底）
/// 注意：调用方需已持有 guard，token 缺失时按空串比较必然失败
fn bearer_ok(guard: &ServerInner, auth_header: &str, query: &HashMap<String, String>) -> bool {
    let Some(token) = guard.token.as_ref() else {
        return false;
    };
    let auth = auth_header
        .strip_prefix("Bearer ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| query.get("token").cloned().unwrap_or_default());
    !auth.is_empty() && constant_time_eq(&auth, token)
}

/// 常数时间字符串比较，避免时序侧信道
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// 请求域名是否匹配条目域名（条目域名为请求域名的精确值或上级域）
fn domain_matches(request_domain: &str, entry_domain: &str) -> bool {
    let rd = request_domain.trim().to_lowercase();
    let ed = entry_domain.trim().to_lowercase();
    if rd.is_empty() || ed.is_empty() {
        return false;
    }
    if rd == ed {
        return true;
    }
    // 子域匹配：rd 以 "." + ed 结尾（避免热路径内 format! 分配）
    rd.len() > ed.len()
        && rd.ends_with(&ed)
        && rd.as_bytes()[rd.len() - ed.len() - 1] == b'.'
}

fn json_response<T: Serialize>(
    status: u16,
    payload: &T,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_string(payload).unwrap_or_else(|_| "{}".into());
    tiny_http::Response::from_data(body.into_bytes())
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..])
                .unwrap(),
        )
}

fn text_response(status: u16, text: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_data(text.as_bytes().to_vec())
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/plain; charset=utf-8"[..])
                .unwrap(),
        )
}

/// 本地服务的并发 worker 数（tiny_http 官方多线程模式：
/// Arc<Server> + N 线程各自 recv；单个慢请求不再阻塞其他请求）
const SERVER_WORKERS: usize = 4;

/// POST body 上限（/capture 的 JSON 凭据远小于此，上限防内存滥用）
const MAX_BODY_BYTES: u64 = 64 * 1024;

/// 事件发射器：route 只经它把事件交给前端窗口。
/// 生产实现由 AppHandle 提供；测试注入录制实现，从而能在真实端口上跑通整条 HTTP 腿。
pub(crate) type EventSender = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

/// 启动本地 HTTP 服务（常驻后台，多线程接收）
pub fn spawn_local_server(app: AppHandle, state: ServerState) -> Result<(), String> {
    let addr = format!("127.0.0.1:{}", LOCAL_SERVER_PORT);
    let server = Arc::new(
        tiny_http::Server::http(&addr).map_err(|e| format!("本地服务启动失败 {}: {}", addr, e))?,
    );
    let app_for_emit = app.clone();
    let emit: EventSender = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = app_for_emit.emit(event, payload);
    });
    spawn_workers(server, state.clone_inner(), emit);

    let _ = app.emit("lockpass:server-started", LOCAL_SERVER_PORT);
    Ok(())
}

/// 起 N 个 worker 线程消费连接（真实监听 + 解析 + route，与生产完全同一路径）
fn spawn_workers(server: Arc<tiny_http::Server>, inner: Arc<Mutex<ServerInner>>, emit: EventSender) {
    for worker in 0..SERVER_WORKERS {
        let server = server.clone();
        let inner = inner.clone();
        let emit = emit.clone();
        std::thread::spawn(move || loop {
            let mut request = match server.recv() {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[LockPass/server] worker {worker} 接收请求失败: {e}");
                    continue;
                }
            };

            let method = request.method().clone();
            let url = request.url().to_string();
            let (path, query) = match url.split_once('?') {
                Some((p, q)) => (p.to_string(), q.to_string()),
                None => (url.clone(), String::new()),
            };
            let query_params: HashMap<String, String> = query
                .split('&')
                .filter(|s| !s.is_empty())
                .filter_map(|kv| {
                    let mut it = kv.splitn(2, '=');
                    let k = it.next()?.to_string();
                    let v = it.next().unwrap_or("").to_string();
                    Some((k, v))
                })
                .collect();

            // body：仅 POST 读取（/capture 消费 JSON，其余接口只需排空防连接挂起），带上限防内存滥用；
            // trait object 上不可用 Read::take（Sized 约束），手动分块读取
            let body = if method == tiny_http::Method::Post {
                let reader = request.as_reader();
                let mut out: Vec<u8> = Vec::new();
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            // 超限：停止读取，后续 JSON 解析必然失败按 400 处理
                            if out.len() + n > MAX_BODY_BYTES as usize {
                                break;
                            }
                            out.extend_from_slice(&buf[..n]);
                        }
                        Err(_) => break,
                    }
                }
                out
            } else {
                Vec::new()
            };

            // 提取 Authorization: Bearer <token>（/credentials 鉴权用）
            let auth_header = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str().to_string())
                .unwrap_or_default();

            let response = route(&emit, &inner, method, &path, &query_params, &auth_header, &body);
            let _ = request.respond(response);
        });
    }
}

/// route 的事件与状态入口：供 spawn_workers 与测试共用
fn route(
    emit: &EventSender,
    inner: &Arc<Mutex<ServerInner>>,
    method: tiny_http::Method,
    path: &str,
    query: &HashMap<String, String>,
    auth_header: &str,
    body: &[u8],
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    match (method, path) {
        (tiny_http::Method::Get, "/status") => {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let payload = serde_json::json!({ "unlocked": guard.unlocked, "paired": guard.token.is_some() });
            json_response(200, &payload)
        }

        (tiny_http::Method::Get, "/credentials") => {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            // 优先 Authorization: Bearer <token>，兼容旧 query ?token= 兜底
            if !bearer_ok(&guard, auth_header, query) {
                return json_response(401, &serde_json::json!({ "error": "unauthorized" }));
            }
            let domain = query.get("domain").cloned().unwrap_or_default();
            if domain.is_empty() {
                return json_response(400, &serde_json::json!({ "error": "missing domain" }));
            }
            let matched: Vec<&EntryDto> = guard
                .entries
                .iter()
                .filter(|e| domain_matches(&domain, &e.domain))
                .collect();
            json_response(200, &matched)
        }

        (tiny_http::Method::Post, "/pair") => {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let nonce = generate_nonce();
            guard.pending_pair = Some(PendingPair {
                nonce: nonce.clone(),
                token: None,
                created_at: now_secs(),
            });
            drop(guard);
            // 通知 Tauri 前端弹出配对确认框
            emit("lockpass:pair-request", serde_json::json!(nonce.clone()));
            json_response(200, &serde_json::json!({ "nonce": nonce }))
        }

        (tiny_http::Method::Get, "/pair/poll") => {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let nonce = query.get("nonce").cloned().unwrap_or_default();
            let Some(pair) = &guard.pending_pair else {
                return json_response(404, &serde_json::json!({ "status": "invalid", "error": "no pending pair" }));
            };
            if !constant_time_eq(&nonce, &pair.nonce) {
                return json_response(404, &serde_json::json!({ "status": "invalid", "error": "nonce mismatch" }));
            }
            // 超时清理
            if now_secs().saturating_sub(pair.created_at) > PAIR_PENDING_TTL_SECS {
                guard.pending_pair = None;
                return json_response(410, &serde_json::json!({ "status": "expired" }));
            }
            if let Some(token) = &pair.token {
                let token = token.clone();
                guard.pending_pair = None; // 一次性领取
                json_response(200, &serde_json::json!({ "status": "confirmed", "token": token }))
            } else {
                json_response(200, &serde_json::json!({ "status": "pending" }))
            }
        }

        (tiny_http::Method::Post, "/pair/cancel") => {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            guard.pending_pair = None;
            json_response(200, &serde_json::json!({ "ok": true }))
        }

        (tiny_http::Method::Post, "/capture") => {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if !bearer_ok(&guard, auth_header, query) {
                eprintln!("[capture] POST /capture -> 401 unauthorized");
                return json_response(401, &serde_json::json!({ "error": "unauthorized" }));
            }
            if !guard.unlocked {
                eprintln!("[capture] POST /capture -> 409 locked");
                return json_response(409, &serde_json::json!({ "error": "locked" }));
            }
            let payload: CapturePayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[capture] POST /capture -> 400 invalid body: {e}");
                    return json_response(400, &serde_json::json!({ "error": "invalid body" }));
                }
            };
            let domain = payload.domain.trim().to_lowercase();
            let username = payload.username.trim().to_string();
            let password = payload.password;
            // 标题为展示性字段：宽松清洗（去控制符、截 200 字符）而非参与 400 拒绝
            let title: String = payload
                .title
                .chars()
                .filter(|c| !c.is_control())
                .collect::<String>()
                .trim()
                .chars()
                .take(200)
                .collect();
            // 长度与字符形状校验：仅接受单行主机名与非空口令，其余一律拒绝
            if domain.is_empty()
                || domain.len() > 253
                || username.len() > 512
                || password.is_empty()
                || password.len() > 4096
                || domain.contains('/')
                || domain.chars().any(|c| c.is_whitespace() || c.is_control())
                || username.chars().any(|c| c.is_control())
                || password.chars().any(|c| c.is_control())
            {
                // 诊断日志只记形状与长度，绝不落凭据内容
                eprintln!(
                    "[capture] POST /capture -> 400 invalid payload: domain_len={} username_len={} password_len={} domain_has_slash={}",
                    domain.chars().count(),
                    username.chars().count(),
                    password.chars().count(),
                    domain.contains('/'),
                );
                return json_response(400, &serde_json::json!({ "error": "invalid payload" }));
            }
            let id = generate_capture_id();
            // 先清超时槽位；仍满则挤掉最旧的一个（其扩展侧轮询会得到 404 按失败提示）
            guard.prune_expired_captures(now_secs());
            while guard.pending_captures.len() >= MAX_PENDING_CAPTURES {
                let evicted = guard.pending_captures.remove(0);
                eprintln!("[capture] 槽位满，挤掉最旧未领取捕获 id={}", evicted.id);
            }
            guard.pending_captures.push(PendingCapture {
                id: id.clone(),
                created_at: now_secs(),
                status: "pending".to_string(),
            });
            drop(guard);
            // 凭据只经本地 IPC 交给前端确认弹窗，Rust 侧不保留副本
            eprintln!("[capture] POST /capture -> 200 id={id}，已发 lockpass:capture-request 事件");
            emit(
                "lockpass:capture-request",
                serde_json::json!({
                    "id": id,
                    "domain": domain,
                    "username": username,
                    "password": password,
                    "title": title,
                }),
            );
            json_response(200, &serde_json::json!({ "ok": true, "id": id }))
        }

        (tiny_http::Method::Get, "/capture/status") => {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if !bearer_ok(&guard, auth_header, query) {
                return json_response(401, &serde_json::json!({ "error": "unauthorized" }));
            }
            let id = query.get("id").cloned().unwrap_or_default();
            let expired = guard.prune_expired_captures(now_secs());
            let Some(idx) = guard.find_capture(&id) else {
                // 刚被清理的超时槽位仍区分报 expired，扩展侧据此提示
                if expired.iter().any(|e| constant_time_eq(e, &id)) {
                    eprintln!("[capture] GET /capture/status -> 410 expired id={id}");
                    return json_response(410, &serde_json::json!({ "status": "expired" }));
                }
                eprintln!("[capture] GET /capture/status -> 404 槽位不存在 id={id}（可能被锁屏清空/已领取/服务重启）");
                return json_response(404, &serde_json::json!({ "status": "invalid" }));
            };
            let status = guard.pending_captures[idx].status.clone();
            if status != "pending" {
                guard.pending_captures.remove(idx); // 一次性领取
                eprintln!("[capture] GET /capture/status -> 领取终态 {status} id={id}");
            }
            json_response(200, &serde_json::json!({ "status": status }))
        }

        (tiny_http::Method::Get, "/") => {
            json_response(200, &serde_json::json!({ "name": "lockpass-local", "version": 1 }))
        }

        _ => text_response(404, "not found"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{Shutdown, SocketAddr, TcpStream};
    use std::time::Duration;

    /// 真实监听（随机端口）+ 事件录制的测试服务：走的是与生产同一套 tiny_http 解析与 route 分派
    struct TestServer {
        addr: SocketAddr,
        inner: Arc<Mutex<ServerInner>>,
        events: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
    }

    fn start_server() -> TestServer {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").expect("测试端口绑定失败"));
        let addr = server
            .server_addr()
            .to_ip()
            .expect("测试端口应绑定在 TCP 上");
        let inner = Arc::new(Mutex::new(ServerInner::default()));
        let events: Arc<Mutex<Vec<(String, serde_json::Value)>>> = Arc::new(Mutex::new(Vec::new()));
        let recorder = events.clone();
        let emit: EventSender = Arc::new(move |event: &str, payload: serde_json::Value| {
            recorder.lock().unwrap().push((event.to_string(), payload));
        });
        spawn_workers(server, inner.clone(), emit);
        TestServer { addr, inner, events }
    }

    fn build_request(method: &str, path: &str, auth: Option<&str>, body: &str) -> String {
        let mut req = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n");
        if let Some(header_value) = auth {
            // 传入完整头值（"Bearer <token>"），helper 不再补前缀，避免双重 Bearer 造成恒 401
            req.push_str(&format!("Authorization: {header_value}\r\n"));
        }
        if body.is_empty() {
            req.push_str("\r\n");
        } else {
            req.push_str(&format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                body.len()
            ));
        }
        req.push_str(body);
        req
    }

    /// 返回 (状态码, JSON 响应体解析结果，解析失败时为原始文本)
    fn call(ts: &TestServer, method: &str, path: &str, token: Option<&str>, body: &str) -> (u16, serde_json::Value) {
        let raw = build_request(method, path, token, body);
        let mut stream = TcpStream::connect(ts.addr).expect("连接测试服务失败");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("设置读超时失败");
        stream.write_all(raw.as_bytes()).expect("发送请求失败");
        stream.shutdown(Shutdown::Write).expect("半关闭失败");
        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(_) => break, // 超时/中断：按已收到的内容解析
            }
        }
        let text = String::from_utf8_lossy(&buf).to_string();
        let status = text
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let body_text = text.splitn(2, "\r\n\r\n").nth(1).unwrap_or("").to_string();
        let json = serde_json::from_str(&body_text)
            .unwrap_or_else(|_| serde_json::Value::String(body_text));
        (status, json)
    }

    /// 模拟「已配对 + 已解锁」（生产环境分别由 server_pair_confirm / server_ready 设置）
    fn unlock(ts: &TestServer, token: &str) {
        let mut guard = ts.inner.lock().unwrap();
        guard.token = Some(token.to_string());
        guard.unlocked = true;
    }

    fn capture_body(domain: &str, username: &str, password: &str) -> String {
        serde_json::json!({ "domain": domain, "username": username, "password": password }).to_string()
    }

    fn emitted_captures(ts: &TestServer) -> Vec<(String, serde_json::Value)> {
        ts.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(event, _)| event == "lockpass:capture-request")
            .map(|(_, payload)| (payload["id"].as_str().unwrap_or_default().to_string(), payload.clone()))
            .collect()
    }

    fn post_capture(ts: &TestServer, token: Option<&str>, body: &str) -> (u16, serde_json::Value) {
        call(ts, "POST", "/capture", token, body)
    }

    fn poll_status(ts: &TestServer, token: Option<&str>, id: &str) -> (u16, serde_json::Value) {
        call(ts, "GET", &format!("/capture/status?id={id}"), token, "")
    }

    #[test]
    fn capture_without_token_is_unauthorized_and_emits_nothing() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let (status, body) = post_capture(&ts, None, &capture_body("github.com", "alice", "pw"));
        assert_eq!(status, 401);
        assert_eq!(body["error"], "unauthorized");
        assert!(emitted_captures(&ts).is_empty());
        assert!(ts.inner.lock().unwrap().pending_captures.is_empty());
    }

    #[test]
    fn capture_with_wrong_token_is_unauthorized() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let (status, _) = post_capture(&ts, Some("Bearer wrong"), &capture_body("github.com", "a", "pw"));
        assert_eq!(status, 401);
    }

    #[test]
    fn capture_while_locked_is_conflict_and_emits_nothing() {
        let ts = start_server();
        ts.inner.lock().unwrap().token = Some("t0k3n".into()); // 已配对但未解锁
        let (status, body) = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("github.com", "a", "pw"));
        assert_eq!(status, 409);
        assert_eq!(body["error"], "locked");
        assert!(emitted_captures(&ts).is_empty());
    }

    #[test]
    fn capture_rejects_malformed_payloads() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let cases = [
            ("", "alice", "pw"), // 空域名
            ("g it hub.com", "alice", "pw"), // 域名含空白
            ("github.com/x", "alice", "pw"), // 域名含路径
            ("github.com", "alice", ""), // 空口令
            ("github.com", "ali\nce", "pw"), // 账号含控制字符
            ("github.com", "alice", "p\u{1}W"), // 口令含控制字符
        ];
        for (domain, username, password) in cases {
            let (status, body) = post_capture(&ts, Some("Bearer t0k3n"), &capture_body(domain, username, password));
            assert_eq!(status, 400, "应拒绝：{domain:?} {username:?} {password:?}，实际 {body}");
        }
        // 非法 JSON 同样按 400
        let (status, _) = post_capture(&ts, Some("Bearer t0k3n"), "{not json");
        assert_eq!(status, 400);
        assert!(emitted_captures(&ts).is_empty());
    }

    #[test]
    fn capture_registers_slot_and_emits_credential_to_window() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let (status, body) = post_capture(
            &ts,
            Some("Bearer t0k3n"),
            &capture_body(" GitHub.COM ", "  alice ", "pw"),
        );
        assert_eq!(status, 200);
        let id = body["id"].as_str().unwrap_or_default().to_string();
        assert!(!id.is_empty(), "应下发捕获 id");

        let events = emitted_captures(&ts);
        assert_eq!(events.len(), 1, "一次请求只发一个事件");
        let (event_id, payload) = &events[0];
        assert_eq!(event_id, &id);
        // 域名归一化（小写 + 去空白）后交给窗口
        assert_eq!(payload["domain"], "github.com");
        assert_eq!(payload["username"], "alice");
        assert_eq!(payload["password"], "pw");

        let guard = ts.inner.lock().unwrap();
        assert_eq!(guard.pending_captures.len(), 1);
        assert_eq!(guard.pending_captures[0].status, "pending");
        // Rust 侧只留 id/状态，不保留明文凭据
        let retained = format!("{:?}", guard.pending_captures[0]);
        assert!(!retained.contains("pw"), "槽位不应保留明文：{retained}");
    }

    #[test]
    fn capture_sanitizes_page_title_and_defaults_when_absent() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let long_title = format!("GitHub 登录{}\x01", "x".repeat(300));
        let body = serde_json::json!({
            "domain": "github.com",
            "username": "alice",
            "password": "pw",
            "title": long_title,
        })
        .to_string();
        let (status, _) = post_capture(&ts, Some("Bearer t0k3n"), &body);
        assert_eq!(status, 200, "标题过长/含控制符应宽松清洗而非拒绝");
        let events = emitted_captures(&ts);
        let title = events[0].1["title"].as_str().unwrap_or_default().to_string();
        assert!(!title.contains('\x01'), "控制字符应被剔除：{title}");
        assert_eq!(title.chars().count(), 200, "标题应截断到 200 字符");
        assert!(title.starts_with("GitHub 登录"), "正常前缀应保留");
        // 旧版扩展载荷缺 title：默认空串交给前端回退域名，不影响 200
        let (status2, _) = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("github.com", "bob", "pw"));
        assert_eq!(status2, 200);
        let events2 = emitted_captures(&ts);
        assert_eq!(events2.last().unwrap().1["title"], serde_json::json!(""));
    }

    #[test]
    fn status_flows_pending_to_one_time_claim() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let (_, body) = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("github.com", "alice", "pw"));
        let id = body["id"].as_str().unwrap().to_string();

        let (status, pending) = poll_status(&ts, Some("Bearer t0k3n"), &id);
        assert_eq!(status, 200);
        assert_eq!(pending["status"], "pending");

        let state = ServerState(ts.inner.clone());
        state.report_capture(&id, "created").expect("回报应成功");

        let (status, claimed) = poll_status(&ts, Some("Bearer t0k3n"), &id);
        assert_eq!(status, 200);
        assert_eq!(claimed["status"], "created");

        // 一次性领取：结果取走即销毁，重复轮询不得再读到
        let (status, again) = poll_status(&ts, Some("Bearer t0k3n"), &id);
        assert_eq!(status, 404);
        assert_eq!(again["status"], "invalid");
    }

    #[test]
    fn status_requires_token_and_rejects_unknown_id() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let (status, _) = poll_status(&ts, None, "deadbeef");
        assert_eq!(status, 401);
        let (status, body) = poll_status(&ts, Some("Bearer t0k3n"), "deadbeef");
        assert_eq!(status, 404);
        assert_eq!(body["status"], "invalid");
    }

    #[test]
    fn report_rejects_unknown_status_and_stale_id() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let state = ServerState(ts.inner.clone());
        assert!(state.report_capture("nope", "created").is_err());
        let (_, body) = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("github.com", "a", "pw"));
        let id = body["id"].as_str().unwrap().to_string();
        assert!(state.report_capture(&id, "succeeded").is_err(), "非白名单状态应拒绝");
        assert!(state.report_capture(&id, "").is_err());
        // 非法回报不得改变槽位
        assert_eq!(ts.inner.lock().unwrap().pending_captures[0].status, "pending");
    }

    #[test]
    fn expired_slot_returns_410_and_is_dropped() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let stale_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string();
        ts.inner.lock().unwrap().pending_captures.push(PendingCapture {
            id: stale_id.clone(),
            created_at: now_secs() - CAPTURE_PENDING_TTL_SECS - 1,
            status: "pending".to_string(),
        });
        let (status, body) = poll_status(&ts, Some("Bearer t0k3n"), &stale_id);
        assert_eq!(status, 410);
        assert_eq!(body["status"], "expired");
        assert!(ts.inner.lock().unwrap().pending_captures.is_empty(), "超时槽位应被丢弃");
    }

    #[test]
    fn concurrent_captures_are_tracked_independently() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let state = ServerState(ts.inner.clone());
        let first = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("a.example.com", "u1", "p1"))
            .1["id"]
            .as_str()
            .unwrap()
            .to_string();
        let second = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("b.example.com", "u2", "p2"))
            .1["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_ne!(first, second);
        assert_eq!(emitted_captures(&ts).len(), 2);

        state.report_capture(&second, "rejected").unwrap();
        state.report_capture(&first, "created").unwrap();

        // 各自回报各自领取，互不顶掉
        let (_, a) = poll_status(&ts, Some("Bearer t0k3n"), &first);
        assert_eq!(a["status"], "created");
        let (_, b) = poll_status(&ts, Some("Bearer t0k3n"), &second);
        assert_eq!(b["status"], "rejected");
    }

    #[test]
    fn pending_captures_are_bounded_and_evict_oldest() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let mut ids = Vec::new();
        for _ in 0..MAX_PENDING_CAPTURES {
            let id = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("e.example.com", "u", "pw"))
                .1["id"]
                .as_str()
                .unwrap()
                .to_string();
            ids.push(id);
        }
        assert_eq!(ts.inner.lock().unwrap().pending_captures.len(), MAX_PENDING_CAPTURES);
        let overflow = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("f.example.com", "u", "pw"))
            .1["id"]
            .as_str()
            .unwrap()
            .to_string();
        let guard = ts.inner.lock().unwrap();
        assert_eq!(guard.pending_captures.len(), MAX_PENDING_CAPTURES, "超出上限不应无限增长");
        assert_eq!(guard.pending_captures.first().unwrap().id, ids[1], "应挤掉最旧的槽位");
        assert!(guard.pending_captures.iter().any(|c| c.id == overflow));
        drop(guard);
        // 被挤掉的请求轮询得到 404，扩展侧按失败提示而非静默卡住
        assert_eq!(poll_status(&ts, Some("Bearer t0k3n"), &ids[0]).0, 404);
    }

    #[test]
    fn lock_discards_pending_captures() {
        let ts = start_server();
        unlock(&ts, "t0k3n");
        let id = post_capture(&ts, Some("Bearer t0k3n"), &capture_body("github.com", "a", "pw"))
            .1["id"]
            .as_str()
            .unwrap()
            .to_string();
        ServerState(ts.inner.clone()).lock().unwrap();
        assert!(ts.inner.lock().unwrap().pending_captures.is_empty());
        assert_eq!(poll_status(&ts, Some("Bearer t0k3n"), &id).0, 404);
    }

    #[test]
    fn pair_and_status_legs_still_work_after_refactor() {
        let ts = start_server();
        let (status, body) = call(&ts, "GET", "/status", None, "");
        assert_eq!(status, 200);
        assert_eq!(body["unlocked"], false);
        assert_eq!(body["paired"], false);

        let (status, body) = call(&ts, "POST", "/pair", None, "");
        assert_eq!(status, 200);
        let nonce = body["nonce"].as_str().unwrap().to_string();
        assert_eq!(nonce.len(), 6);
        // 只在取快照时持锁，后续请求要交给 worker 线程写 events
        let emitted_pair_event = ts
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(event, _)| event == "lockpass:pair-request");
        assert!(emitted_pair_event);

        let state = ServerState(ts.inner.clone());
        let token = state.confirm_pair(&nonce).unwrap();
        let (status, polled) = call(&ts, "GET", &format!("/pair/poll?nonce={nonce}"), None, "");
        assert_eq!(status, 200);
        assert_eq!(polled["status"], "confirmed");
        assert_eq!(polled["token"], token);
        // 一次性领取后重复轮询应为 invalid
        assert_eq!(call(&ts, "GET", &format!("/pair/poll?nonce={nonce}"), None, "").0, 404);
        // 配对发放的令牌可直接用于 /capture（真实端到端串联）
        state.set_ready(true).unwrap();
        let (status, _) = post_capture(&ts, Some(&format!("Bearer {token}")), &capture_body("github.com", "a", "pw"));
        assert_eq!(status, 200);
    }
}
