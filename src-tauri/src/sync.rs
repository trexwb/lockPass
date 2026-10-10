// LockPass — 局域网同步服务（设计文档 docs/multi-device-sync-design.md §7）
//
// 职责边界（比设计文档更严格的落地选择）：
//   🔴 本模块**不持有任何密钥、不做任何密码学运算、不见一条明文条目**。
//      Rust 侧只有三件事：搬运密文信封、记会话状态、发 HTTP。
//   · 同步口令 P 与会话鉴权密钥 K_auth 由前端 Web Crypto 生成与持有，
//     挑战-响应的 `mac` 与载荷 `mac` 都由前端裁决，Rust 只负责把待裁决
//     请求经事件转交前端并等待布尔结果（见 AuthPending / ApplyPending）。
//     这比「Rust 侧算 HMAC」多一次 IPC，换来的是：K_auth 永不进入 Rust 内存，
//     且无需引入 hmac / pbkdf2 等外部 crate（离线优先：不新增依赖）。
//   · 与扩展桥（server.rs，绑 127.0.0.1:33555）是**两个独立 tiny_http 实例**，
//     同步实例不存在 /credentials 之类的明文面（编译期隔离，不是路由内 if）。
//
// 端点（§7.2）：
//   GET  /sync/hello      无鉴权  {deviceId, schemaRev, appVersion, serverTime, sessionSalt, hasVault, rev}
//   GET  /sync/challenge  无鉴权  {challenge}
//   POST /sync/auth       mac     {mac} → {sessionToken}
//   GET  /sync/snapshot   Bearer  {salt, iterations, iv, data, mac, rev}
//   POST /sync/apply      Bearer  {salt, iterations, iv, data, mac, baseRev, rev} → {ok, newRev}
//   POST /sync/deactivate Bearer  {} → {ok}
//
// 请求发起方：B 侧（含桌面版）由 Rust 发起 HTTP，避免为 LAN 地址永久放宽 CSP
// connect-src（tauri.conf.json:29）；浏览器客户端由页面直连，故服务端必须回 CORS 头。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, UdpSocket};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

/* ── 常量 ──────────────────────────────────────────────────── */

/// 同步协议版本：两端不一致即拒绝，不做部分合并（400 E_SCHEMA_MISMATCH）
pub const SYNC_SCHEMA_REV: u32 = 1;

/// 首选端口；被占用时向后探测（不复用扩展桥的 33555）
const SYNC_PORT_PREFERRED: u16 = 5613;
const SYNC_PORT_TRIES: u16 = 20;

/// 会话生命周期（秒）：超时即 410 E_SESSION_EXPIRED
const SESSION_TTL_SECS: u64 = 600;

/// 挑战一次性，60 秒作废
const CHALLENGE_TTL_SECS: u64 = 60;

/// 鉴权失败上限：达到即销毁服务实例（P 不是加密密钥，但拿到它就能拉走
/// 可离线爆破的密文，限速必须保留 —— 设计文档 §4.2）
const MAX_AUTH_FAILS: u32 = 3;

/// 前端裁决等待上限（秒）：前端未在时限内回报即按失败处理，不无限挂起连接。
/// 取 180 与「捕获确认槽位 TTL」同量级 —— A 侧裁决回写时可能要弹窗让用户输入
/// 主密码，跨应用耗时不可控。
const VERDICT_TIMEOUT_SECS: u64 = 180;

/// 同步端点载荷上限（整库快照可达数百 KB，远高于扩展桥的 64 KB）
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// 出站 HTTP 超时（秒）
const CLIENT_TIMEOUT_SECS: u64 = 30;

/* ── 数据结构 ──────────────────────────────────────────────── */

/// 加密信封（与 file-sync.js 的负载同构，不新增格式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub salt: String,
    pub iterations: u64,
    pub iv: String,
    pub data: String,
}

/// 待前端裁决的鉴权请求（Rust 不持有 K_auth，只搬运 challenge 与 mac）
struct AuthPending {
    challenge: String,
    #[allow(dead_code)]
    mac: String,
    tx: Sender<bool>,
}

/// 待前端裁决的回写请求
struct ApplyPending {
    id: String,
    /// 裁决通过后被采纳为新快照的信封（已含 B 侧合并结果）
    envelope: Envelope,
    /// 随该信封一并采纳的 mac
    mac: String,
    rev: u64,
    tx: Sender<bool>,
}

#[derive(Default)]
struct SyncInner {
    running: bool,
    port: u16,
    bind_ip: String,
    device_id: String,
    app_version: String,
    unlocked: bool,
    /// 会话盐（base64），随 hello 下发；K_auth 由两端各自用 P + 此盐派生
    session_salt: String,
    started_at: u64,
    last_activity: u64,
    /// 服务端快照（密文信封），仅内存
    snapshot: Option<Envelope>,
    /// 快照完整性 mac = HMAC(K_auth, iv‖data)：由 A 前端算好后随快照下发，
    /// B 解密前先验，防中间人替换密文诱导两端一起写入被污染的库（§4.2）
    snapshot_mac: String,
    rev: u64,
    challenge: Option<(String, u64)>,
    session_token: Option<(String, u64)>,
    auth_fails: u32,
    auth_pending: Option<AuthPending>,
    apply_pending: Option<ApplyPending>,
}

/// 线程间共享的同步服务状态
#[derive(Clone, Default)]
pub struct SyncState(Arc<Mutex<SyncInner>>);

impl SyncState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(SyncInner::default())))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SyncInner>, String> {
        self.0.lock().map_err(|_| "同步服务状态锁定失败".to_string())
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// CSPRNG hex 串（getrandom / OS 随机源）
fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("OS 随机源不可用");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
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

/* ── 局域网 IPv4 枚举 ──────────────────────────────────────── */

/// 候选局域网地址：排除回环与链路本地（169.254.x.x 是"插了网线没拿到地址"，
/// 展示出来只会误导用户）
fn is_usable_lan_ip(ip: &str) -> bool {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    let nums: Option<Vec<u8>> = parts.iter().map(|p| p.parse::<u8>().ok()).collect();
    let Some(n) = nums else { return false };
    if n[0] == 127 || (n[0] == 169 && n[1] == 254) {
        return false;
    }
    true
}

/// 兜底：用 UDP connect 拿到"出默认路由的那张网卡"的地址。
/// 不发任何报文——connect 只查路由表，不产生网络流量。
fn default_route_ip() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("198.51.100.1:80").ok()?; // TEST-NET-2，纯占位不发包
    let addr = sock.local_addr().ok()?;
    let ip = addr.ip().to_string();
    if is_usable_lan_ip(&ip) {
        Some(ip)
    } else {
        None
    }
}

/// 枚举本机局域网 IPv4（多网卡 / VPN / 热点下地址不固定，必须由用户单选）。
/// 用系统命令而非新增 crate：离线优先，不为一次枚举引入依赖。
fn list_local_ips() -> Vec<String> {
    let out = if cfg!(target_os = "windows") {
        run_cmd("ipconfig", &[]).unwrap_or_default()
    } else if cfg!(target_os = "macos") {
        run_cmd("ifconfig", &[]).unwrap_or_default()
    } else {
        // Linux：ifconfig 属 net-tools 已弃用，ip 才是标配
        run_cmd("ip", &["-4", "-o", "addr", "show"])
            .or_else(|_| run_cmd("ifconfig", &[]))
            .unwrap_or_default()
    };

    let mut ips: Vec<String> = Vec::new();
    for line in out.lines() {
        let cand = if cfg!(target_os = "windows") {
            // "   IPv4 Address. . . . . . . . . . . . : 192.168.3.177"
            line.split_once(':').map(|(_, v)| v.trim().to_string())
        } else if cfg!(target_os = "linux") && !line.contains("inet ") {
            None
        } else {
            // "inet 192.168.3.177 netmask ..." / "inet 192.168.3.177/24 ..."
            let mut it = line.split_whitespace();
            let mut found: Option<String> = None;
            while let Some(tok) = it.next() {
                if tok == "inet" {
                    if let Some(v) = it.next() {
                        found = Some(v.split('/').next().unwrap_or(v).to_string());
                    }
                    break;
                }
            }
            found
        };
        if let Some(ip) = cand {
            if is_usable_lan_ip(&ip) && !ips.contains(&ip) {
                ips.push(ip);
            }
        }
    }
    if ips.is_empty() {
        if let Some(ip) = default_route_ip() {
            ips.push(ip);
        }
    }
    ips
}

fn run_cmd(prog: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new(prog)
        .args(args)
        .output()
        .map_err(|e| format!("执行 {prog} 失败: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/* ── HTTP 响应构造（含 CORS）──────────────────────────────────
   浏览器客户端（file:// 页面 Origin 为 null）无法白名单匹配，故 ACAO 只能为 *；
   鉴权不靠同源，靠一次性口令 + K_auth 挑战-响应（设计文档 §7.1）。 */

fn json_response<T: Serialize>(
    status: u16,
    payload: &T,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_string(payload).unwrap_or_else(|_| "{}".into());
    let mut resp = tiny_http::Response::from_data(body.into_bytes()).with_status_code(status);
    add_cors(&mut resp);
    resp
}

fn cors_preflight() -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut resp =
        tiny_http::Response::from_data(Vec::new()).with_status_code(204);
    add_cors(&mut resp);
    resp
}

fn add_cors(resp: &mut tiny_http::Response<std::io::Cursor<Vec<u8>>>) {
    let headers = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "content-type, authorization"),
        ("Access-Control-Max-Age", "600"),
    ];
    for (k, v) in headers {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            resp.add_header(h);
        }
    }
}

/* ── 服务端路由 ────────────────────────────────────────────── */

#[derive(Serialize)]
struct HelloOut {
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "schemaRev")]
    schema_rev: u32,
    #[serde(rename = "appVersion")]
    app_version: String,
    #[serde(rename = "serverTime")]
    server_time: u64,
    #[serde(rename = "sessionSalt")]
    session_salt: String,
    #[serde(rename = "hasVault")]
    has_vault: bool,
    rev: u64,
}

fn handle_hello(g: &SyncInner) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    if !g.unlocked {
        return json_response(403, &serde_json::json!({ "error": "E_LOCKED" }));
    }
    json_response(
        200,
        &HelloOut {
            device_id: g.device_id.clone(),
            schema_rev: SYNC_SCHEMA_REV,
            app_version: g.app_version.clone(),
            server_time: now_secs(),
            session_salt: g.session_salt.clone(),
            has_vault: g.snapshot.is_some(),
            rev: g.rev,
        },
    )
}

/// 会话是否过期（600s 绝对上限 + 600s 无活动）
fn session_alive(g: &SyncInner) -> bool {
    let now = now_secs();
    now.saturating_sub(g.started_at) <= SESSION_TTL_SECS
        && now.saturating_sub(g.last_activity) <= SESSION_TTL_SECS
}

fn bearer_ok(g: &SyncInner, auth_header: &str, query: &HashMap<String, String>) -> bool {
    let Some((token, issued)) = g.session_token.as_ref() else {
        return false;
    };
    // 令牌本身也有 TTL，过期即失效（与会话生命周期同一口径）
    if now_secs().saturating_sub(*issued) > SESSION_TTL_SECS {
        return false;
    }
    let auth = auth_header
        .strip_prefix("Bearer ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| query.get("token").cloned().unwrap_or_default());
    !auth.is_empty() && constant_time_eq(&auth, token)
}

/// 事件发射器：route 只经它把「待前端裁决的请求」交出去。
/// 生产实现由 AppHandle 提供；测试注入录制实现，从而能在真实端口上跑通整条 HTTP 腿。
type EventSender = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

fn route(
    emit: &EventSender,
    state: &Arc<Mutex<SyncInner>>,
    method: &tiny_http::Method,
    path: &str,
    query: &HashMap<String, String>,
    auth_header: &str,
    body: &[u8],
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let method = method.clone();
    if method == tiny_http::Method::Options {
        return cors_preflight();
    }

    let now = now_secs();

    /* ── 无鉴权端点 ── */
    if method == tiny_http::Method::Get && path == "/sync/hello" {
        let mut g = match state.lock() {
            Ok(g) => g,
            Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
        };
        g.last_activity = now;
        return handle_hello(&g);
    }

    if method == tiny_http::Method::Get && path == "/sync/challenge" {
        let mut g = match state.lock() {
            Ok(g) => g,
            Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
        };
        if !session_alive(&g) {
            return json_response(410, &serde_json::json!({ "error": "E_SESSION_EXPIRED" }));
        }
        if !g.unlocked {
            return json_response(403, &serde_json::json!({ "error": "E_LOCKED" }));
        }
        g.last_activity = now;
        let challenge = random_hex(32);
        g.challenge = Some((challenge.clone(), now));
        return json_response(200, &serde_json::json!({ "challenge": challenge }));
    }

    if method == tiny_http::Method::Post && path == "/sync/auth" {
        let pending = {
            let mut g = match state.lock() {
                Ok(g) => g,
                Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
            };
            if !session_alive(&g) {
                return json_response(410, &serde_json::json!({ "error": "E_SESSION_EXPIRED" }));
            }
            g.last_activity = now;
            let Some((challenge, issued)) = g.challenge.clone() else {
                return json_response(400, &serde_json::json!({ "error": "E_NO_CHALLENGE" }));
            };
            if now.saturating_sub(issued) > CHALLENGE_TTL_SECS {
                g.challenge = None;
                return json_response(401, &serde_json::json!({ "error": "E_BAD_MAC" }));
            }
            let Ok(v) = serde_json::from_slice::<serde_json::Value>(body) else {
                return json_response(400, &serde_json::json!({ "error": "E_BAD_BODY" }));
            };
            let mac = v.get("mac").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if mac.is_empty() {
                return json_response(400, &serde_json::json!({ "error": "E_BAD_BODY" }));
            }
            let (tx, rx) = channel::<bool>();
            g.auth_pending = Some(AuthPending {
                challenge: challenge.clone(),
                mac: mac.clone(),
                tx,
            });
            g.challenge = None; // 挑战一次性
            (challenge, mac, rx)
        };

        // 交前端裁决：mac 是否等于 HMAC(K_auth, challenge) 只有持有 K_auth 的前端能判
        emit(
            "lockpass:sync-auth",
            serde_json::json!({ "challenge": pending.0, "mac": pending.1 }),
        );
        let ok = pending
            .2
            .recv_timeout(Duration::from_secs(VERDICT_TIMEOUT_SECS))
            .unwrap_or(false);

        let mut g = match state.lock() {
            Ok(g) => g,
            Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
        };
        g.auth_pending = None;
        if !ok {
            g.auth_fails += 1;
            if g.auth_fails >= MAX_AUTH_FAILS {
                // 爆破防护：销毁服务实例，必须重新开启
                g.running = false;
                g.session_token = None;
                emit("lockpass:sync-destroyed", serde_json::json!({}));
                return json_response(429, &serde_json::json!({ "error": "E_TOO_MANY_AUTH_FAILS" }));
            }
            return json_response(401, &serde_json::json!({ "error": "E_BAD_MAC" }));
        }
        let token = random_hex(32);
        g.session_token = Some((token.clone(), now));
        return json_response(200, &serde_json::json!({ "sessionToken": token }));
    }

    /* ── 以下端点需要 Bearer 会话令牌 ── */
    let authed = {
        let g = match state.lock() {
            Ok(g) => g,
            Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
        };
        if !session_alive(&g) {
            return json_response(410, &serde_json::json!({ "error": "E_SESSION_EXPIRED" }));
        }
        bearer_ok(&g, auth_header, query)
    };
    if !authed {
        return json_response(401, &serde_json::json!({ "error": "E_BAD_MAC" }));
    }

    if method == tiny_http::Method::Get && path == "/sync/snapshot" {
        let mut g = match state.lock() {
            Ok(g) => g,
            Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
        };
        g.last_activity = now;
        let Some(env) = g.snapshot.clone() else {
            return json_response(404, &serde_json::json!({ "error": "E_NO_VAULT" }));
        };
        return json_response(
            200,
            &serde_json::json!({
                "salt": env.salt, "iterations": env.iterations, "iv": env.iv,
                "data": env.data, "mac": g.snapshot_mac, "rev": g.rev,
            }),
        );
    }

    if method == tiny_http::Method::Post && path == "/sync/apply" {
        let (apply_id, rx) = {
            let mut g = match state.lock() {
                Ok(g) => g,
                Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
            };
            g.last_activity = now;
            let Ok(v) = serde_json::from_slice::<serde_json::Value>(body) else {
                return json_response(400, &serde_json::json!({ "error": "E_BAD_BODY" }));
            };
            let base_rev = v.get("baseRev").and_then(|x| x.as_u64()).unwrap_or(0);
            // 乐观锁：A 在 B 拉取后被改过 → 409，B 自动重跑一轮
            if base_rev != g.rev {
                return json_response(409, &serde_json::json!({ "error": "E_REV_CONFLICT", "currentRev": g.rev }));
            }
            let env = Envelope {
                salt: v.get("salt").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                iterations: v.get("iterations").and_then(|x| x.as_u64()).unwrap_or(0),
                iv: v.get("iv").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                data: v.get("data").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            };
            if env.salt.is_empty() || env.iv.is_empty() || env.data.is_empty() {
                return json_response(400, &serde_json::json!({ "error": "E_BAD_BODY" }));
            }
            let new_rev = v.get("rev").and_then(|x| x.as_u64()).unwrap_or(g.rev);
            let apply_id = random_hex(16);
            let (tx, rx) = channel::<bool>();
            g.apply_pending = Some(ApplyPending {
                id: apply_id.clone(),
                envelope: env.clone(),
                mac: v.get("mac").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                rev: new_rev,
                tx,
            });
            emit(
                "lockpass:sync-apply",
                serde_json::json!({
                    "id": apply_id,
                    "salt": env.salt, "iterations": env.iterations,
                    "iv": env.iv, "data": env.data,
                    "mac": v.get("mac").and_then(|x| x.as_str()).unwrap_or(""),
                    "baseRev": base_rev, "rev": new_rev,
                }),
            );
            (apply_id, rx)
        };

        let ok = rx
            .recv_timeout(Duration::from_secs(VERDICT_TIMEOUT_SECS))
            .unwrap_or(false);

        let mut g = match state.lock() {
            Ok(g) => g,
            Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
        };
        let pending = g.apply_pending.take();
        if !ok {
            return json_response(401, &serde_json::json!({ "error": "E_BAD_MAC" }));
        }
        // A 不做二次合并：B 推来的已是合并完成的整包，校验通过即原样落盘
        if let Some(p) = pending {
            g.snapshot = Some(p.envelope);
            g.snapshot_mac = p.mac;
            g.rev = p.rev;
        }
        emit(
            "lockpass:sync-applied",
            serde_json::json!({ "id": apply_id, "rev": g.rev }),
        );
        return json_response(200, &serde_json::json!({ "ok": true, "newRev": g.rev }));
    }

    if method == tiny_http::Method::Post && path == "/sync/deactivate" {
        let mut g = match state.lock() {
            Ok(g) => g,
            Err(_) => return json_response(500, &serde_json::json!({ "error": "E_INTERNAL" })),
        };
        g.running = false;
        g.session_token = None;
        emit("lockpass:sync-deactivated", serde_json::json!({}));
        return json_response(200, &serde_json::json!({ "ok": true }));
    }

    json_response(404, &serde_json::json!({ "error": "E_NOT_FOUND" }))
}

/// 启动同步服务（独立 tiny_http 实例，绑定选定网卡的局域网 IPv4）
/// 不依赖 AppHandle：事件经注入的 EventSender 发出，测试可注入录制实现。
fn spawn_sync_server(
    emit: EventSender,
    state: Arc<Mutex<SyncInner>>,
    bind_ip: &str,
) -> Result<u16, String> {
    let mut last_err = String::new();
    for offset in 0..SYNC_PORT_TRIES {
        let port = SYNC_PORT_PREFERRED + offset;
        let addr = format!("{bind_ip}:{port}");
        match tiny_http::Server::http(&addr) {
            Ok(server) => {
                let server = Arc::new(server);
                for worker in 0..4 {
                    let server = Arc::clone(&server);
                    let state = Arc::clone(&state);
                    let emit = Arc::clone(&emit);
                    std::thread::spawn(move || loop {
                        // 用 recv_timeout 而不是 recv：tiny_http 没有 shutdown 接口，
                        // 若阻塞在 recv 上，「停止服务」后 worker 永不退出、端口也不会释放。
                        // 每 500ms 醒来检查一次 running 标志，停止即退出并释放端口。
                        {
                            let Ok(g) = state.lock() else { break };
                            if !g.running {
                                break;
                            }
                        }
                        let mut request = match server.recv_timeout(Duration::from_millis(500)) {
                            Ok(Some(r)) => r,
                            Ok(None) => continue, // 超时：回去再查一次 running
                            Err(_) => break,
                        };
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
                        // body：仅 POST 读取，带上限防内存滥用；
                        // trait object 上不可用 Read::take（Sized 约束），手动分块读取
                        let body = if request.method() == &tiny_http::Method::Post {
                            let mut out: Vec<u8> = Vec::new();
                            let mut buf = [0u8; 8192];
                            loop {
                                match request.as_reader().read(&mut buf) {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        // 超限：停止读取，后续 JSON 解析必然失败按 400 处理
                                        if out.len() + n > MAX_BODY_BYTES {
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
                        let auth_header = request
                            .headers()
                            .iter()
                            .find(|h| h.field.equiv("Authorization"))
                            .map(|h| h.value.as_str().to_string())
                            .unwrap_or_default();
                        let resp = route(
                            &emit,
                            &state,
                            request.method(),
                            &path,
                            &query_params,
                            &auth_header,
                            &body,
                        );
                        let _ = request.respond(resp);
                        let _ = worker;
                    });
                }
                return Ok(port);
            }
            Err(e) => last_err = format!("{addr}: {e}"),
        }
    }
    Err(format!("同步服务启动失败，已试 {} 个端口：{last_err}", SYNC_PORT_TRIES))
}

/* ── 出站 HTTP（B 侧客户端；不新增依赖的手写最小客户端）────────
   为什么手写而不是 reqwest：项目离线优先，不为一次 LAN 请求引入整套
   HTTP 栈；且链路两端都由本模块实现，报文形态完全可控（服务端一律
   Content-Length 响应，客户端只需支持 Content-Length 与 chunked 两种）。 */

#[derive(Debug, Clone, Serialize)]
pub struct HttpReply {
    pub status: u16,
    pub body: String,
}

fn split_url(url: &str) -> Result<(String, u16, String), String> {
    // 只认明文 http：同步链路按设计文档 §7.4 不上 TLS（浏览器客户端靠 file://
    // 页面直连，桌面端靠本模块发起），放行 https 只会让人误以为链路是加密的。
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| format!("不支持的 URL 协议（同步服务只使用 http）: {url}"))?;
    let (authority, path) = match rest.split_once('/') {
        Some((a, p)) => (a.to_string(), format!("/{p}")),
        None => (rest.to_string(), "/".to_string()),
    };
    let (host, port) = match authority.split_once(':') {
        Some((h, p)) => (
            h.to_string(),
            p.parse::<u16>().map_err(|_| format!("端口非法: {p}"))?,
        ),
        None => (authority, 80u16),
    };
    if host.is_empty() {
        return Err("URL 缺少主机".into());
    }
    Ok((host, port, path))
}

fn http_request(
    method: &str,
    url: &str,
    body: Option<&str>,
    bearer: Option<&str>,
) -> Result<HttpReply, String> {
    let (host, port, path) = split_url(url)?;
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr).map_err(|e| format!("连接 {addr} 失败: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(CLIENT_TIMEOUT_SECS)))
        .map_err(|e| format!("设置读超时失败: {e}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(CLIENT_TIMEOUT_SECS)))
        .map_err(|e| format!("设置写超时失败: {e}"))?;

    let mut req = String::new();
    req.push_str(&format!("{method} {path} HTTP/1.1\r\n"));
    req.push_str(&format!("Host: {addr}\r\n"));
    req.push_str("Connection: close\r\n");
    req.push_str("User-Agent: LockPass-sync/1\r\n");
    if let Some(b) = body {
        req.push_str("Content-Type: application/json\r\n");
        req.push_str(&format!("Content-Length: {}\r\n", b.as_bytes().len()));
    }
    if let Some(t) = bearer {
        if !t.is_empty() {
            req.push_str(&format!("Authorization: Bearer {t}\r\n"));
        }
    }
    req.push_str("\r\n");
    if let Some(b) = body {
        req.push_str(b);
    }

    let mut stream = stream;
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("发送请求失败: {e}"))?;
    stream.flush().map_err(|e| format!("刷新发送缓冲失败: {e}"))?;

    let mut reader = BufReader::new(&mut stream);

    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .map_err(|e| format!("读取状态行失败: {e}"))?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| format!("状态行无法解析: {}", status_line.trim()))?;

    let mut content_length: Option<usize> = None;
    let mut chunked = false;
    loop {
        let mut line = String::new();
        if reader
            .read_line(&mut line)
            .map_err(|e| format!("读取响应头失败: {e}"))?
            == 0
        {
            break;
        }
        let line = line.trim_end_matches(['\r', '\n']).to_string();
        if line.is_empty() {
            break;
        }
        let lower = line.to_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse::<usize>().ok();
        } else if lower.starts_with("transfer-encoding:") && lower.contains("chunked") {
            chunked = true;
        }
    }

    let body = if chunked {
        let mut out: Vec<u8> = Vec::new();
        loop {
            let mut size_line = String::new();
            if reader
                .read_line(&mut size_line)
                .map_err(|e| format!("读取分块长度失败: {e}"))?
                == 0
            {
                break;
            }
            let size = usize::from_str_radix(size_line.trim(), 16).unwrap_or(0);
            if size == 0 {
                break;
            }
            let mut chunk = vec![0u8; size];
            reader
                .read_exact(&mut chunk)
                .map_err(|e| format!("读取分块数据失败: {e}"))?;
            out.extend_from_slice(&chunk);
            let mut crlf = [0u8; 2];
            let _ = std::io::Read::read_exact(&mut reader, &mut crlf);
        }
        out
    } else if let Some(len) = content_length {
        let len = len.min(MAX_BODY_BYTES);
        let mut buf = vec![0u8; len];
        reader
            .read_exact(&mut buf)
            .map_err(|e| format!("读取响应体失败: {e}"))?;
        buf
    } else {
        // 无 Content-Length 且非 chunked：读到连接关闭
        let mut out = Vec::new();
        let _ = std::io::Read::read_to_end(&mut reader, &mut out);
        out
    };

    Ok(HttpReply {
        status,
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

/* ── Tauri 命令 ────────────────────────────────────────────── */

/// 枚举本机局域网 IPv4（供 A 侧面板单选）
#[tauri::command]
pub fn sync_list_local_ips() -> Result<Vec<String>, String> {
    Ok(list_local_ips())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStartArgs {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "appVersion")]
    pub app_version: String,
    #[serde(rename = "sessionSalt")]
    pub session_salt: String,
    pub snapshot: Envelope,
    /// HMAC(K_auth, iv‖data)：快照完整性绑定
    pub mac: String,
    pub rev: u64,
    #[serde(rename = "travelMode")]
    pub travel_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStartResult {
    pub port: u16,
    #[serde(rename = "bindIp")]
    pub bind_ip: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
}

/// 开启同步服务：绑定选定网卡 IPv4，起独立 tiny_http 实例
#[tauri::command]
pub fn sync_start(
    app: tauri::AppHandle,
    state: tauri::State<SyncState>,
    args: SyncStartArgs,
    bind_ip: String,
) -> Result<SyncStartResult, String> {
    if args.travel_mode {
        return Err("E_TRAVEL_MODE".into());
    }
    if !is_usable_lan_ip(&bind_ip) {
        return Err(format!("不是可用的局域网 IPv4: {bind_ip}"));
    }
    let inner = Arc::clone(&state.0);
    {
        let mut g = state.lock()?;
        if g.running {
            return Err("同步服务已在运行".into());
        }
        g.bind_ip = bind_ip.clone();
        g.device_id = args.device_id;
        g.app_version = args.app_version;
        g.session_salt = args.session_salt;
        g.snapshot = Some(args.snapshot);
        g.snapshot_mac = args.mac;
        g.rev = args.rev;
        g.started_at = now_secs();
        g.last_activity = now_secs();
        g.auth_fails = 0;
        g.challenge = None;
        g.session_token = None;
        // 必须在 spawn 之前置位：worker 每 500ms 查一次 running，
        // 先 spawn 后置位会让它立刻判定「已停止」而退出。
        g.running = true;
    }
    // 事件发射器：把「待前端裁决的请求」转发给 webview；测试注入录制实现。
    let emit: EventSender = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = app.emit(event, payload);
    });
    let port = match spawn_sync_server(emit, inner, &bind_ip) {
        Ok(p) => p,
        Err(e) => {
            let mut g = state.lock()?;
            g.running = false;
            return Err(e);
        }
    };
    {
        let mut g = state.lock()?;
        g.port = port;
    }
    Ok(SyncStartResult {
        port,
        bind_ip,
        expires_at: now_secs() + SESSION_TTL_SECS,
    })
}

/// 停止服务并清空全部会话态（含内存中的密文快照）
#[tauri::command]
pub fn sync_stop(state: tauri::State<SyncState>) -> Result<(), String> {
    let mut g = state.lock()?;
    g.running = false;
    g.snapshot = None;
    g.snapshot_mac.clear();
    g.session_token = None;
    g.challenge = None;
    g.auth_pending = None;
    g.apply_pending = None;
    g.port = 0;
    g.bind_ip.clear();
    g.session_salt.clear();
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub running: bool,
    pub port: u16,
    #[serde(rename = "bindIp")]
    pub bind_ip: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    #[serde(rename = "authFails")]
    pub auth_fails: u32,
    pub rev: u64,
}

/// 服务状态（前端据此渲染倒计时与失败次数）
#[tauri::command]
pub fn sync_status(state: tauri::State<SyncState>) -> Result<SyncStatus, String> {
    let g = state.lock()?;
    Ok(SyncStatus {
        running: g.running,
        port: g.port,
        bind_ip: g.bind_ip.clone(),
        expires_at: g.started_at + SESSION_TTL_SECS,
        auth_fails: g.auth_fails,
        rev: g.rev,
    })
}

/// 解锁 / 锁定同步（未解锁时对端 hello 会收到 403 E_LOCKED）
#[tauri::command]
pub fn sync_set_ready(state: tauri::State<SyncState>, unlocked: bool) -> Result<(), String> {
    let mut g = state.lock()?;
    g.unlocked = unlocked;
    Ok(())
}

/// 服务运行中本机数据发生变更时刷新快照（保证对端拉到的是最新密文）
#[tauri::command]
pub fn sync_set_snapshot(
    state: tauri::State<SyncState>,
    snapshot: Envelope,
    rev: u64,
    mac: String,
) -> Result<(), String> {
    let mut g = state.lock()?;
    g.snapshot = Some(snapshot);
    g.snapshot_mac = mac;
    g.rev = rev;
    Ok(())
}

/// 裁决挑战-响应的核心逻辑（与 Tauri 状态解耦，便于测试直接驱动）
fn answer_auth_inner(
    state: &Arc<Mutex<SyncInner>>,
    challenge: &str,
    ok: bool,
) -> Result<(), String> {
    let g = state.lock().map_err(|_| "同步服务状态锁定失败".to_string())?;
    let Some(pending) = g.auth_pending.as_ref() else {
        return Err("没有待裁决的鉴权请求".into());
    };
    if pending.challenge != challenge {
        return Err("挑战值不匹配，裁决已忽略".into());
    }
    let _ = pending.tx.send(ok);
    Ok(())
}

/// 前端裁决挑战-响应：mac 是否等于 HMAC(K_auth, challenge)
#[tauri::command]
pub fn sync_auth_verdict(
    state: tauri::State<SyncState>,
    challenge: String,
    ok: bool,
) -> Result<(), String> {
    answer_auth_inner(&state.0, &challenge, ok)
}

/// 裁决回写的核心逻辑（与 Tauri 状态解耦，便于测试直接驱动）
fn answer_apply_inner(state: &Arc<Mutex<SyncInner>>, id: &str, ok: bool) -> Result<(), String> {
    // 🔴 关键：只借用（as_ref）而不 take。裁决通过后 HTTP 处理线程还要用
    // pending 里的信封 / mac / rev 去更新服务端快照；这里提前取走会让
    // apply 返回 200 但服务端数据原地不动 —— 表现为「同步显示成功、对端没更新」，
    // 且下次同步的 baseRev 永远对不上，反复 409。
    let g = state.lock().map_err(|_| "同步服务状态锁定失败".to_string())?;
    let Some(pending) = g.apply_pending.as_ref() else {
        return Err("没有待裁决的回写请求".into());
    };
    if pending.id != id {
        return Err("回写 id 不匹配，裁决已忽略".into());
    }
    let _ = pending.tx.send(ok);
    Ok(())
}

/// 前端裁决回写：校验 mac 通过并已落盘后回报
#[tauri::command]
pub fn sync_apply_verdict(
    state: tauri::State<SyncState>,
    id: String,
    ok: bool,
) -> Result<(), String> {
    answer_apply_inner(&state.0, &id, ok)
}

/// 出站 HTTP（B 侧用）：Tauri 的 CSP connect-src 不放行 LAN 地址，
/// 故桌面版必须由 Rust 发起请求，密文经 IPC 交 webview 解密合并。
#[tauri::command]
pub async fn sync_client_request(
    method: String,
    url: String,
    body: Option<String>,
    bearer: Option<String>,
) -> Result<HttpReply, String> {
    let m = method.clone();
    let u = url.clone();
    let b = body.clone();
    let t = bearer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        http_request(&m, &u, b.as_deref(), t.as_deref())
    })
    .await
    .map_err(|e| format!("同步请求任务异常: {e}"))?
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_parse_splits_host_port_path() {
        let (host, port, path) = split_url("http://192.168.3.177:5613/sync/hello").unwrap();
        assert_eq!(host, "192.168.3.177");
        assert_eq!(port, 5613);
        assert_eq!(path, "/sync/hello");

        // 无端口：默认 80
        let (host, port, path) = split_url("http://10.0.0.5/sync/apply").unwrap();
        assert_eq!(host, "10.0.0.5");
        assert_eq!(port, 80);
        assert_eq!(path, "/sync/apply");

        // 根路径
        let (_, _, path) = split_url("http://10.0.0.5:9000").unwrap();
        assert_eq!(path, "/");
    }

    #[test]
    fn url_parse_rejects_unsupported() {
        // 同步链路是明文 http（§7.4），其余协议一律拒绝
        assert!(split_url("https://10.0.0.5/sync/hello").is_err());
        assert!(split_url("ftp://10.0.0.5/x").is_err());
        assert!(split_url("10.0.0.5:1234").is_err());
        assert!(split_url("http://:5613/x").is_err());
        assert!(split_url("http://10.0.0.5:99999/x").is_err());
    }

    #[test]
    fn lan_ip_filter_excludes_loopback_and_link_local() {
        assert!(is_usable_lan_ip("192.168.3.177"));
        assert!(is_usable_lan_ip("10.0.0.5"));
        assert!(!is_usable_lan_ip("127.0.0.1"));
        assert!(!is_usable_lan_ip("169.254.1.2"));
        assert!(!is_usable_lan_ip("not-an-ip"));
        assert!(!is_usable_lan_ip("192.168.1"));
    }

    #[test]
    fn constant_time_eq_is_exact() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
        assert!(!constant_time_eq("", "a"));
    }

    #[test]
    fn random_hex_is_unique_and_sized() {
        let a = random_hex(32);
        let b = random_hex(32);
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }

    /* ── 端到端：真实 socket 上跑通「手写客户端 ↔ 同步服务端」─────────
       为什么必须有这组测试：出站客户端是手写的（离线优先，不引入 reqwest），
       没有第三方实现兜底。「端口能连上（nc 通）但同步失败」这类现象只有在这里
       才能定性 —— 否则只能靠猜。 */

    /// 起一个绑定 127.0.0.1 的同步服务，返回（端口, 状态, 事件录制器）
    fn spawn_test_server() -> (u16, Arc<Mutex<SyncInner>>, Arc<Mutex<Vec<(String, serde_json::Value)>>>) {
        let state = Arc::new(Mutex::new(SyncInner {
            running: true,
            unlocked: true,
            device_id: "test-device".into(),
            app_version: "1.1.5".into(),
            session_salt: "c2FsdA==".into(),
            started_at: now_secs(),
            last_activity: now_secs(),
            snapshot: Some(Envelope {
                salt: "c2FsdA==".into(),
                iterations: 600000,
                iv: "aXY=".into(),
                data: "ZGF0YQ==".into(),
            }),
            snapshot_mac: "deadbeef".into(),
            rev: 7,
            ..Default::default()
        }));
        let events: Arc<Mutex<Vec<(String, serde_json::Value)>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);
        let emit: EventSender = Arc::new(move |name: &str, payload: serde_json::Value| {
            sink_events
                .lock()
                .unwrap()
                .push((name.to_string(), payload.clone()));
        });
        let port = spawn_sync_server(emit, Arc::clone(&state), "127.0.0.1")
            .expect("测试服务启动失败");
        (port, state, events)
    }

    #[test]
    fn e2e_hello_returns_session_material() {
        let (port, _state, _events) = spawn_test_server();
        let reply = http_request("GET", &format!("http://127.0.0.1:{port}/sync/hello"), None, None)
            .expect("hello 请求失败");
        assert_eq!(reply.status, 200);
        let v: serde_json::Value = serde_json::from_str(&reply.body).expect("hello 响应不是 JSON");
        assert_eq!(v["schemaRev"], SYNC_SCHEMA_REV);
        assert_eq!(v["sessionSalt"], "c2FsdA==");
        assert_eq!(v["rev"], 7);
        assert_eq!(v["hasVault"], true);
        assert!(v["serverTime"].as_u64().unwrap() > 0);
    }

    #[test]
    fn e2e_hello_rejects_when_locked() {
        let (port, state, _events) = spawn_test_server();
        state.lock().unwrap().unlocked = false;
        let reply = http_request("GET", &format!("http://127.0.0.1:{port}/sync/hello"), None, None)
            .expect("hello 请求失败");
        assert_eq!(reply.status, 403);
        let v: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(v["error"], "E_LOCKED");
    }

    #[test]
    fn e2e_challenge_then_snapshot_requires_token() {
        let (port, _state, _events) = spawn_test_server();
        let ch = http_request("GET", &format!("http://127.0.0.1:{port}/sync/challenge"), None, None)
            .expect("challenge 请求失败");
        assert_eq!(ch.status, 200);
        let chv: serde_json::Value = serde_json::from_str(&ch.body).unwrap();
        assert_eq!(chv["challenge"].as_str().unwrap().len(), 64);

        // 未鉴权取快照 → 401
        let snap = http_request("GET", &format!("http://127.0.0.1:{port}/sync/snapshot"), None, None)
            .expect("snapshot 请求失败");
        assert_eq!(snap.status, 401);
        let snapv: serde_json::Value = serde_json::from_str(&snap.body).unwrap();
        assert_eq!(snapv["error"], "E_BAD_MAC");
    }

    /// 鉴权 → 取快照 → 回写 → 关闭：验证手写客户端的 POST 与 Bearer 头也走得通。
    /// 前端裁决由测试直接驱动（测试里算不了 HMAC，直接给 ok=true）。
    #[test]
    fn e2e_auth_snapshot_apply_deactivate_round_trip() {
        let (port, state, events) = spawn_test_server();
        let base = format!("http://127.0.0.1:{port}");

        // 1) 取挑战
        let ch = http_request("GET", &format!("{base}/sync/challenge"), None, None).unwrap();
        let challenge = serde_json::from_str::<serde_json::Value>(&ch.body).unwrap()["challenge"]
            .as_str()
            .unwrap()
            .to_string();

        // 2) 前端裁决线程：收到事件后立刻回报 true
        let st = Arc::clone(&state);
        let ch2 = challenge.clone();
        std::thread::spawn(move || {
            for _ in 0..100 {
                if answer_auth_inner(&st, &ch2, true).is_ok() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });

        // 3) 鉴权
        let auth = http_request(
            "POST",
            &format!("{base}/sync/auth"),
            Some(r#"{"mac":"00"}"#),
            None,
        )
        .expect("auth 请求失败");
        assert_eq!(auth.status, 200, "body={}", auth.body);
        let token = serde_json::from_str::<serde_json::Value>(&auth.body).unwrap()["sessionToken"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(token.len(), 64);

        // 4) 取快照（带 Bearer）
        let snap = http_request("GET", &format!("{base}/sync/snapshot"), None, Some(&token))
            .expect("snapshot 请求失败");
        assert_eq!(snap.status, 200);
        let snapv: serde_json::Value = serde_json::from_str(&snap.body).unwrap();
        assert_eq!(snapv["salt"], "c2FsdA==");
        assert_eq!(snapv["mac"], "deadbeef");
        assert_eq!(snapv["rev"], 7);

        // 5) 回写：baseRev 必须等于服务端当前 rev，否则 409
        let bad = http_request(
            "POST",
            &format!("{base}/sync/apply"),
            Some(r#"{"salt":"c2FsdA==","iterations":600000,"iv":"aXY=","data":"ZGF0YQ==","mac":"x","baseRev":1,"rev":8}"#),
            Some(&token),
        )
        .expect("apply 请求失败");
        assert_eq!(bad.status, 409);

        let st2 = Arc::clone(&state);
        std::thread::spawn(move || {
            for _ in 0..100 {
                let id = {
                    let ev = events.lock().unwrap();
                    ev.iter()
                        .find(|(n, _)| n == "lockpass:sync-apply")
                        .and_then(|(_, p)| p.get("id").and_then(|v| v.as_str()).map(str::to_string))
                };
                if let Some(id) = id {
                    let _ = answer_apply_inner(&st2, &id, true);
                    return;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });

        let good = http_request(
            "POST",
            &format!("{base}/sync/apply"),
            Some(r#"{"salt":"c2FsdA==","iterations":600000,"iv":"aXY=","data":"ZGF0YQ==","mac":"x","baseRev":7,"rev":9}"#),
            Some(&token),
        )
        .expect("apply 请求失败");
        assert_eq!(good.status, 200, "body={}", good.body);
        // A 采纳了 B 推来的整包：快照与 rev 同步前进
        {
            let g = state.lock().unwrap();
            assert_eq!(g.rev, 9);
        }

        // 6) 关闭
        let off = http_request("POST", &format!("{base}/sync/deactivate"), Some("{}"), Some(&token))
            .expect("deactivate 请求失败");
        assert_eq!(off.status, 200);
    }

    #[test]
    fn e2e_options_preflight_returns_cors() {
        let (port, _state, _events) = spawn_test_server();
        let reply = http_request("OPTIONS", &format!("http://127.0.0.1:{port}/sync/auth"), None, None)
            .expect("预检请求失败");
        assert_eq!(reply.status, 204);
    }

    /// 关闭后 worker 必须退出、端口释放（否则重开会串到下一个端口）
    #[test]
    fn stop_releases_the_port() {
        let (port, state, _events) = spawn_test_server();
        state.lock().unwrap().running = false;
        // 等 worker 轮询发现 running=false 并退出（500ms 轮询 + 余量）
        std::thread::sleep(Duration::from_millis(1200));
        let again = tiny_http::Server::http(format!("127.0.0.1:{port}"));
        assert!(again.is_ok(), "停止服务后端口 {port} 仍未释放");
    }
}
