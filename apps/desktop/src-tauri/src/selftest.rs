// P1 gate verification harness. Runs the same command functions the frontend
// calls via `invoke()`, in-process, so the fetch -> download -> library_list
// loop can be exercised end-to-end without UI automation. Gated behind
// RIPPO_P1_SELFTEST=1; not wired into the invoke_handler or shipped UI.
// TODO(P1 gate verification): delete this module before starting P2.

use crate::commands::{self, AppState};
use serde_json::json;
use tauri::{AppHandle, Manager};

pub async fn run(app: AppHandle) {
    log::info!("[selftest] starting P1 gate self-test");

    match commands::health(app.clone()).await {
        Ok(health) => log::info!("[selftest] health ok: {health}"),
        Err(e) => {
            log::error!("[selftest] health FAILED: {e}");
            return;
        }
    }

    let url = std::env::var("RIPPO_P1_SELFTEST_URL")
        .unwrap_or_else(|_| "https://archive.org/details/SampleVideo1280x7205mb".to_string());

    let fetch_result = match commands::fetch(app.clone(), url.clone(), None).await {
        Ok(result) => {
            log::info!("[selftest] fetch ok: {result}");
            result
        }
        Err(e) => {
            log::error!("[selftest] fetch FAILED: {e}");
            return;
        }
    };

    if fetch_result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        log::error!("[selftest] fetch returned ok=false, stopping: {fetch_result}");
        return;
    }

    let state: tauri::State<AppState> = app.state();
    let payload: commands::DownloadRequest = serde_json::from_value(json!({
        "url": url,
        "preset": "mp4-best",
        "itemId": "selftest01",
        "title": "Rippo P1 selftest",
    }))
    .expect("selftest download payload should deserialize");

    match commands::download(app.clone(), state, payload).await {
        Ok(response) => log::info!(
            "[selftest] download ok jobId={} result={}",
            response.job_id,
            response.result
        ),
        Err(e) => {
            log::error!("[selftest] download FAILED: {e}");
            return;
        }
    }

    match commands::library_list(app.clone(), None).await {
        Ok(listing) => log::info!("[selftest] library_list: {listing}"),
        Err(e) => log::error!("[selftest] library_list FAILED: {e}"),
    }

    log::info!("[selftest] P1 gate self-test complete");
}
