mod app_update;
mod commands;
mod cookies;
mod engine;
mod helpers;
mod path_guard;
#[cfg(debug_assertions)]
mod selftest;
mod settings;
mod shell;
pub mod thumbnails;
mod version;

use commands::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use thumbnails::ThumbnailCache;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(AppState {
      jobs: Arc::new(Mutex::new(HashMap::new())),
    })
    .manage(ThumbnailCache::default())
    .invoke_handler(tauri::generate_handler![
      commands::health,
      commands::set_transfer_settings,
      commands::fetch,
      commands::fetch_full,
      commands::download,
      commands::cancel_download,
      commands::library_list,
      commands::failures_list,
      settings::get_settings,
      settings::set_settings,
      settings::choose_output_root,
      settings::reset_output_root,
      cookies::list_cookie_browsers,
      cookies::set_default_cookie_source,
      cookies::set_cookies_browser,
      helpers::check_helpers,
      helpers::update_helpers,
      app_update::check_app_update,
      shell::open_folder,
      shell::open_external,
      shell::open_path,
      shell::show_item_in_folder,
      thumbnails::load_thumbnail,
      thumbnails::load_library_thumbnail,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Gate self-tests: exercise the exact command functions the frontend
      // invokes, without requiring UI automation. Opt-in only; not part of
      // normal `tauri dev`.
      #[cfg(debug_assertions)]
      if std::env::var("RIPPO_P1_SELFTEST").is_ok() {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          selftest::run(handle).await;
        });
      }
      #[cfg(debug_assertions)]
      if std::env::var("RIPPO_P2_SELFTEST").is_ok() {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          selftest::run_p2(handle).await;
        });
      }
      #[cfg(debug_assertions)]
      if std::env::var("RIPPO_THUMBNAILS_SELFTEST").is_ok() {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          selftest::run_thumbnails(handle).await;
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
