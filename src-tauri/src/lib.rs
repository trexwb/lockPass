use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri::{DragDropEvent, WindowEvent};

mod server;

/// 拖放读取白名单（R3 修复）
/// 记录最近一次拖放到窗口内的文件路径，read_text_file_any 仅允许读取白名单中的文件。
/// 使用 Arc<Mutex> 以支持 Clone（窗口事件闭包需要 move 副本；Mutex 本身不可 Clone）。
#[derive(Default, Clone)]
struct DropPaths(Arc<Mutex<Vec<PathBuf>>>);

/// 数据根目录：系统应用数据目录
/// macOS: ~/Library/Application Support/com.lockpass
/// Windows: %APPDATA%\com.lockpass
/// Linux: ~/.local/share/com.lockpass
fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))
}

/// 校验相对路径并拼接，防止目录穿越
/// 拒绝：空路径、绝对路径、`..` / 前缀 / 根目录等特殊组件
fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("路径不能为空".into());
    }
    if relative.contains('\0') {
        return Err("路径包含非法字符".into());
    }
    let p = Path::new(relative);
    if p.is_absolute() {
        return Err(format!("不允许绝对路径: {relative}"));
    }
    let mut out = root.to_path_buf();
    for comp in p.components() {
        match comp {
            Component::Normal(seg) => out.push(seg),
            Component::CurDir => {} // 忽略 "."，无穿越风险
            _ => return Err(format!("路径包含非法组件: {relative}")),
        }
    }
    Ok(out)
}

/// 写入文件（自动创建父目录）
#[tauri::command]
fn file_store_write(
    app: tauri::AppHandle,
    relative_path: String,
    contents: String,
) -> Result<(), String> {
    let root = data_root(&app)?;
    let full = safe_join(&root, &relative_path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&full, contents).map_err(|e| format!("写入文件失败: {e}"))
}

/// 读取文件（不存在时返回 Err）
#[tauri::command]
fn file_store_read(app: tauri::AppHandle, relative_path: String) -> Result<String, String> {
    let root = data_root(&app)?;
    let full = safe_join(&root, &relative_path)?;
    fs::read_to_string(&full).map_err(|e| format!("读取文件失败: {e}"))
}

/// 文件是否存在
#[tauri::command]
fn file_store_exists(app: tauri::AppHandle, relative_path: String) -> Result<bool, String> {
    let root = data_root(&app)?;
    let full = safe_join(&root, &relative_path)?;
    Ok(full.exists())
}

/// 删除文件（不存在时静默成功）
#[tauri::command]
fn file_store_delete(app: tauri::AppHandle, relative_path: String) -> Result<(), String> {
    let root = data_root(&app)?;
    let full = safe_join(&root, &relative_path)?;
    if full.exists() {
        fs::remove_file(&full).map_err(|e| format!("删除文件失败: {e}"))?;
    }
    Ok(())
}

/// 拒绝写入系统敏感目录（S3 修复：导出功能的纵深防御）
/// 导出路径由系统「保存」对话框产生，正常不会落在系统目录；
/// 此处额外拦截，防止前端被 XSS 后利用 export_text_file 覆盖系统文件。
fn is_sensitive_export_path(full: &Path) -> bool {
    const SENSITIVE: &[&str] = &[
        // macOS / Linux
        "/System",
        "/Library",
        "/usr",
        "/bin",
        "/sbin",
        "/private",
        "/etc",
        "/dev",
        "/proc",
        "/sys",
        "/boot",
        "/lib",
        "/lib64",
        "/Applications",
        // Windows
        "C:\\Windows",
        "C:\\Program Files",
    ];
    let s = full.to_string_lossy().to_ascii_uppercase();
    SENSITIVE.iter().any(|p| {
        let p = p.to_ascii_uppercase();
        s == p || s.starts_with(&format!("{p}/")) || s.starts_with(&format!("{p}\\"))
    })
}

/// 导出文本文件（用户通过系统保存对话框选定路径后写入）
/// 仅做基本校验：拒绝空路径、限制为文件而非目录；自动创建父目录
#[tauri::command]
fn export_text_file(path: String, contents: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("保存路径不能为空".into());
    }
    if path.contains('\0') {
        return Err("保存路径包含非法字符".into());
    }
    let full = PathBuf::from(&path);
    if full.is_dir() {
        return Err("保存路径不能是目录".into());
    }
    // S3 修复：拒绝写入系统敏感目录
    if is_sensitive_export_path(&full) {
        return Err("不允许保存到系统目录".into());
    }
    if let Some(parent) = full.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
    }
    fs::write(&full, contents).map_err(|e| format!("写入文件失败: {e}"))
}

/// 授予拖放文件的读取权限（S2 修复：已移除）
/// 原实现允许前端以任意路径调用并覆盖白名单，构成任意文件读取面。
/// 白名单现仅由 setup 中窗口拖放事件（DragDropEvent::Drop）维护，
/// 前端只能读取「真实拖放到窗口内」的文件，杜绝任意路径授权。

/// 读取文本文件（拖放导入用）
/// 限制文件大小 ≤ 10MB，防止超大文件拖垮前端
/// R3 修复：仅允许读取已拖放到窗口内的文件（DropPaths 白名单），
/// 阻止任意路径读取（如读取用户敏感文件）。
#[tauri::command]
fn read_text_file_any(state: tauri::State<DropPaths>, path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("文件路径不能为空".into());
    }
    if path.contains('\0') {
        return Err("文件路径包含非法字符".into());
    }
    let full = PathBuf::from(&path);
    let meta = fs::metadata(&full).map_err(|e| format!("无法访问文件: {e}"))?;
    if !meta.is_file() {
        return Err("目标不是文件".into());
    }
    if meta.len() > 10 * 1024 * 1024 {
        return Err("文件过大（超过 10MB），无法读取".into());
    }
    // R3 修复：路径必须存在于拖放白名单中（PathBuf 相等比较）
    let granted = state.0.lock().map_err(|_| "内部状态锁定失败".to_string())?;
    if !granted.contains(&full) {
        return Err("无权读取该文件：仅允许读取拖放到窗口内的文件".into());
    }
    fs::read_to_string(&full).map_err(|e| format!("读取文件失败: {e}"))
}

/// 返回数据根目录绝对路径（供设置界面展示）
#[tauri::command]
fn file_store_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let root = data_root(&app)?;
    Ok(root.to_string_lossy().to_string())
}

// ===== 本地 HTTP 服务命令（浏览器扩展自动填充）=====

/// 前端解锁后标记本地服务就绪
#[tauri::command]
fn server_ready(state: tauri::State<server::ServerState>) -> Result<(), String> {
    state.set_ready(true)
}

/// 前端解锁后同步明文条目到 Rust 内存（仅内存，不落盘）
#[tauri::command]
fn server_set_entries(
    state: tauri::State<server::ServerState>,
    entries: Vec<server::EntryDto>,
) -> Result<(), String> {
    state.set_entries(entries)
}

/// 锁定/登出时清空内存中的条目与解锁标记
#[tauri::command]
fn server_lock(state: tauri::State<server::ServerState>) -> Result<(), String> {
    state.lock()
}

/// 查询当前待确认的配对 nonce（供前端弹窗展示）
#[tauri::command]
fn server_get_pending_pair(state: tauri::State<server::ServerState>) -> Result<Option<String>, String> {
    state.get_pending_nonce()
}

/// 前端点击「允许」后发放 token
#[tauri::command]
fn server_pair_confirm(
    state: tauri::State<server::ServerState>,
    nonce: String,
) -> Result<String, String> {
    state.confirm_pair(&nonce)
}

/// 前端点击「拒绝」后取消配对
#[tauri::command]
fn server_pair_reject(
    state: tauri::State<server::ServerState>,
    nonce: String,
) -> Result<(), String> {
    state.reject_pair(&nonce)
}

/// URL 字符白名单校验（C3 修复）
/// 仅允许 ASCII 字母数字与 URL 合法符号（RFC 3986 保留/非保留字符及 % 编码符号），
/// 非空且长度 ≤ 2048，其余字符一律拒绝，防止经 URL 注入 shell 元字符。
fn is_safe_url(url: &str) -> bool {
    if url.is_empty() || url.len() > 2048 {
        return false;
    }
    url.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(
                c,
                ':' | '/'
                    | '?'
                    | '#'
                    | '['
                    | ']'
                    | '@'
                    | '!'
                    | '$'
                    | '&'
                    | '\''
                    | '('
                    | ')'
                    | '*'
                    | '+'
                    | ','
                    | ';'
                    | '='
                    | '.'
                    | '-'
                    | '_'
                    | '~'
                    | '%'
            )
    })
}

/// 用系统默认浏览器打开外部链接
/// 仅允许 http://、https://、mailto: 协议，防命令注入 / 非法链接
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return Err(format!("不允许的链接协议: {url}"));
    }
    // C3 修复：协议白名单后再做字符白名单校验
    if !is_safe_url(&url) {
        return Err(format!("链接包含非法字符: {url}"));
    }

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // C3 修复：改用 explorer 直接传参（不经 cmd /C shell 解析，杜绝元字符注入）
        let mut c = Command::new("explorer");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };

    cmd.spawn()
        .map_err(|e| format!("打开链接失败: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DropPaths(Default::default()))
        .manage(server::ServerState::new())
        .setup(|app| {
            // 启动内嵌本地 HTTP 服务（浏览器扩展自动填充用，仅绑定 127.0.0.1）
            {
                let state = app.state::<server::ServerState>();
                let srv = state.inner().clone();
                if let Err(e) = server::spawn_local_server(app.handle().clone(), srv) {
                    eprintln!("[LockPass] 本地 HTTP 服务启动失败: {e}");
                }
            }
            // R3 修复：监听主窗口拖放事件，将拖入文件路径写入白名单
            // （前端 invoke 前也会主动 grant，此处为双保险，确保 Rust 侧先有白名单）
            if let Some(win) = app.get_webview_window("main") {
                let state = app.state::<DropPaths>();
                let drop_paths = state.inner().clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                        if let Ok(mut guard) = drop_paths.0.lock() {
                            *guard = paths.clone();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_store_write,
            file_store_read,
            file_store_exists,
            file_store_delete,
            file_store_data_dir,
            export_text_file,
            read_text_file_any,
            open_url,
            server_ready,
            server_set_entries,
            server_lock,
            server_get_pending_pair,
            server_pair_confirm,
            server_pair_reject,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LockPass tauri application");
}
