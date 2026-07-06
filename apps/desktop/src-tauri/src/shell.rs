// Rust port of the shell-facing bits of apps/desktop/electron/shellOutputIpc.ts
// and electron/libraryIpc.ts. `open_path` / `show_item_in_folder` accept a
// user/engine-reported path and MUST stay inside the current output root —
// this is the same path-guard gate the Electron IPC layer enforced.

use crate::path_guard::assert_within_roots;
use crate::settings::current_output_root;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn open_folder(app: AppHandle, folder: Option<String>) -> Result<(), String> {
    let target = folder.filter(|f| !f.trim().is_empty()).unwrap_or_else(|| current_output_root(&app));
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    app.opener().open_path(&target, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Only http and https URLs can be opened.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https URLs can be opened.".to_string());
    }
    app.opener().open_url(parsed.to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(app: AppHandle, target: String) -> Result<(), String> {
    let root = current_output_root(&app);
    let resolved = assert_within_roots(&target, &[root])?;
    app.opener()
        .open_path(resolved.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_item_in_folder(app: AppHandle, target: String) -> Result<(), String> {
    let root = current_output_root(&app);
    let resolved = assert_within_roots(&target, &[root])?;
    app.opener()
        .reveal_item_in_dir(resolved.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}
