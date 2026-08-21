use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use tauri::Manager;

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
    if let Some(parent) = full.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
    }
    fs::write(&full, contents).map_err(|e| format!("写入文件失败: {e}"))
}

/// 读取文本文件（拖放导入用）
/// 限制文件大小 ≤ 10MB，防止超大文件拖垮前端
#[tauri::command]
fn read_text_file_any(path: String) -> Result<String, String> {
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
    fs::read_to_string(&full).map_err(|e| format!("读取文件失败: {e}"))
}

/// 返回数据根目录绝对路径（供设置界面展示）
#[tauri::command]
fn file_store_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let root = data_root(&app)?;
    Ok(root.to_string_lossy().to_string())
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

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", &url]);
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
        .invoke_handler(tauri::generate_handler![
            file_store_write,
            file_store_read,
            file_store_exists,
            file_store_delete,
            file_store_data_dir,
            export_text_file,
            read_text_file_any,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LockPass tauri application");
}
