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
}

#[derive(Debug, Clone, Default)]
struct PendingPair {
    nonce: String,
    token: Option<String>,
    created_at: u64,
}

#[derive(Debug, Default)]
pub(crate) struct ServerInner {
    unlocked: bool,
    token: Option<String>,
    entries: Vec<EntryDto>,
    pending_pair: Option<PendingPair>,
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
fn generate_token() -> String {
    let mut seed = now_secs()
        ^ (SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0) as u64);
    let mut buf = [0u8; 32];
    for b in buf.iter_mut() {
        // 简易 xorshift，足够应付配对随机性要求
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        *b = (seed & 0xff) as u8;
    }
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 生成 6 位数字 nonce，方便用户在弹窗中肉眼比对
fn generate_nonce() -> String {
    let mut state = now_secs() ^ 0x9E37_79B9_7F4A_7C15;
    let mut out = String::with_capacity(6);
    for _ in 0..6 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        out.push(char::from(b'0' + (state % 10) as u8));
    }
    out
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
    rd.ends_with(&format!(".{}", ed))
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

/// 启动本地 HTTP 服务（阻塞线程，常驻后台）
pub fn spawn_local_server(app: AppHandle, state: ServerState) -> Result<(), String> {
    let addr = format!("127.0.0.1:{}", LOCAL_SERVER_PORT);
    let server = tiny_http::Server::http(&addr).map_err(|e| format!("本地服务启动失败 {}: {}", addr, e))?;
    let inner = state.clone_inner();
    let app_for_thread = app.clone();

    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
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

            // 读取 body（POST 用，目前 /pair 与 /pair/cancel 不需要 body）
            let _body = {
                let mut b = String::new();
                let _ = request.as_reader().read_to_string(&mut b);
                b
            };

            // 提取 Authorization: Bearer <token>（/credentials 鉴权用）
            let auth_header = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str().to_string())
                .unwrap_or_default();

            let response = route(&app_for_thread, &inner, method, &path, &query_params, &auth_header);
            let _ = request.respond(response);
        }
    });

    let _ = app.emit("lockpass:server-started", LOCAL_SERVER_PORT);
    Ok(())
}

fn route(
    app: &AppHandle,
    inner: &Arc<Mutex<ServerInner>>,
    method: tiny_http::Method,
    path: &str,
    query: &HashMap<String, String>,
    auth_header: &str,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    match (method, path) {
        (tiny_http::Method::Get, "/status") => {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let payload = serde_json::json!({ "unlocked": guard.unlocked, "paired": guard.token.is_some() });
            json_response(200, &payload)
        }

        (tiny_http::Method::Get, "/credentials") => {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let token = guard.token.clone().unwrap_or_default();
            // 优先 Authorization: Bearer <token>，兼容旧 query ?token= 兜底
            let auth = auth_header
                .strip_prefix("Bearer ")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| query.get("token").cloned().unwrap_or_default());
            if auth.is_empty() || !constant_time_eq(&auth, &token) {
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
            let _ = app.emit("lockpass:pair-request", nonce.clone());
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

        (tiny_http::Method::Get, "/") => {
            json_response(200, &serde_json::json!({ "name": "lockpass-local", "version": 1 }))
        }

        _ => text_response(404, "not found"),
    }
}
