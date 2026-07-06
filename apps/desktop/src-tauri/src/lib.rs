mod commands;
mod engine;
#[cfg(debug_assertions)]
mod selftest;

use commands::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState {
      jobs: Arc::new(Mutex::new(HashMap::new())),
    })
    .invoke_handler(tauri::generate_handler![
      commands::health,
      commands::fetch,
      commands::fetch_full,
      commands::download,
      commands::cancel_download,
      commands::library_list,
      commands::failures_list,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // P1 gate self-test: exercises health -> fetch -> download -> library_list
      // through the exact same command functions the frontend invokes, without
      // requiring UI automation. Opt-in only; not part of normal `tauri dev`.
      // TODO(P1 gate verification): remove before P2 work lands.
      #[cfg(debug_assertions)]
      if std::env::var("RIPPO_P1_SELFTEST").is_ok() {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          selftest::run(handle).await;
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
