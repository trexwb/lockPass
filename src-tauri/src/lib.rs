use std::fs;
use std::path::{Component, Path, PathBuf};

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

/// 返回数据根目录绝对路径（供设置界面展示）
#[tauri::command]
fn file_store_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let root = data_root(&app)?;
    Ok(root.to_string_lossy().to_string())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running LockPass tauri application");
}
