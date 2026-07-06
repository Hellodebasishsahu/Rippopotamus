// Tauri commands mirroring apps/desktop/electron/engineIpc.ts + libraryIpc.ts.
// P1 landed health/fetch/download/library_list/failures_list against a
// hardcoded `~/Downloads/Rippo` root and no cookies. P2 wires the real
// settings-backed output root + cookie source (see settings.rs / cookies.rs)
// into all of these.

use crate::cookies::{cookie_source_args, cookies_supported, detect_browsers};
use crate::engine::{run_engine, ActiveJobs};
use crate::settings::{current_output_root, current_transfer_settings, default_cookie_source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct AppState {
    pub jobs: ActiveJobs,
}

pub(crate) fn default_output_root(app: &AppHandle) -> std::path::PathBuf {
    std::path::PathBuf::from(current_output_root(app))
}

#[tauri::command]
pub async fn health(app: AppHandle) -> Result<Value, String> {
    let output_root = default_output_root(&app);
    let browsers = detect_browsers(&app);
    let cookie_source = default_cookie_source(&app, &browsers);
    let transfer = current_transfer_settings(&app);

    let mut args = vec!["health".to_string()];
    args.extend(cookie_source_args(&cookie_source));
    let mut payload = run_engine(&app, args, |_| {}, None).await?;
    if let Value::Object(ref mut map) = payload {
        map.insert("outputRoot".into(), json!(output_root.to_string_lossy()));
        map.insert("packaged".into(), json!(!cfg!(debug_assertions)));
        map.insert("cookiesSupported".into(), json!(cookies_supported()));
        map.insert("cookiesBrowsers".into(), json!(browsers));
        map.insert("cookieSource".into(), json!(cookie_source));
        map.insert("transfer".into(), json!(transfer));
    }
    Ok(payload)
}

#[tauri::command]
pub async fn set_transfer_settings(
    app: AppHandle,
    aria2_max_connections: Option<f64>,
    aria2_download_limit: Option<String>,
) -> Result<Value, String> {
    let transfer = crate::settings::write_transfer_settings(&app, aria2_max_connections, aria2_download_limit.as_deref())?;
    Ok(json!({
        "transfer": transfer,
        "health": health(app).await?,
    }))
}

#[derive(Deserialize)]
pub struct FetchArgs {
    url: String,
    provider: Option<String>,
}

async fn fetch_impl(app: AppHandle, args: FetchArgs, full: bool) -> Result<Value, String> {
    let mut cli_args = vec!["fetch".to_string()];
    if full {
        cli_args.push("--full".to_string());
    }
    cli_args.push("--url".to_string());
    cli_args.push(args.url.clone());
    if let Some(provider) = args.provider {
        cli_args.push("--provider".to_string());
        cli_args.push(provider);
    }
    let browsers = detect_browsers(&app);
    cli_args.extend(cookie_source_args(&default_cookie_source(&app, &browsers)));

    match run_engine(&app, cli_args, |_| {}, None).await {
        Ok(payload) => Ok(payload),
        Err(message) => Ok(json!({ "ok": false, "url": args.url, "error": message })),
    }
}

#[tauri::command]
pub async fn fetch(app: AppHandle, url: String, provider: Option<String>) -> Result<Value, String> {
    fetch_impl(app, FetchArgs { url, provider }, false).await
}

#[tauri::command]
pub async fn fetch_full(app: AppHandle, url: String, provider: Option<String>) -> Result<Value, String> {
    fetch_impl(app, FetchArgs { url, provider }, true).await
}

#[derive(Deserialize)]
pub struct DownloadRequest {
    url: String,
    preset: String,
    #[serde(rename = "outputRoot")]
    output_root: Option<String>,
    #[serde(rename = "itemId")]
    item_id: Option<String>,
    title: Option<String>,
}

#[derive(Serialize)]
pub struct DownloadResponse {
    #[serde(rename = "jobId")]
    pub(crate) job_id: String,
    pub(crate) result: Value,
}

fn useful_download_error(message: &str) -> String {
    let trimmed = message.trim();
    let looks_bare = trimmed.is_empty()
        || regex_like_engine_exit(trimmed);
    if looks_bare {
        "Download failed before Rippo received details. Retry the source page or use Sniff page.".to_string()
    } else {
        trimmed.to_string()
    }
}

fn regex_like_engine_exit(message: &str) -> bool {
    // Matches Electron's /^Engine exited with code \d+$/i without pulling in `regex`.
    let lower = message.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("engine exited with code ") {
        return !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit());
    }
    false
}

#[tauri::command]
pub async fn download(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: DownloadRequest,
) -> Result<DownloadResponse, String> {
    let job_id = payload
        .item_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let output_root = guarded_output_root(&app, payload.output_root.clone());
    std::fs::create_dir_all(&output_root).map_err(|e| e.to_string())?;

    let item_id_arg = payload
        .item_id
        .clone()
        .unwrap_or_else(|| job_id.chars().take(10).collect());

    let mut args = vec![
        "download".to_string(),
        "--url".to_string(),
        payload.url.clone(),
        "--preset".to_string(),
        payload.preset.clone(),
        "--output-root".to_string(),
        output_root,
        "--item-id".to_string(),
        item_id_arg,
        "--title".to_string(),
        payload.title.clone().unwrap_or_default(),
    ];
    let browsers = detect_browsers(&app);
    args.extend(cookie_source_args(&default_cookie_source(&app, &browsers)));

    let emit_app = app.clone();
    let emit_job_id = job_id.clone();
    let on_json = move |event: Value| {
        let mut payload = json!({ "jobId": emit_job_id });
        if let (Value::Object(ref mut base), Value::Object(extra)) = (&mut payload, event) {
            for (k, v) in extra {
                base.insert(k, v);
            }
        }
        let _ = emit_app.emit("engine:download-event", payload);
    };

    let jobs = state.jobs.clone();
    match run_engine(&app, args, on_json, Some((jobs, job_id.clone()))).await {
        Ok(result) => Ok(DownloadResponse { job_id, result }),
        Err(error) => {
            let message = useful_download_error(&error);
            if message.to_ascii_lowercase().contains("download canceled") {
                let _ = app.emit(
                    "engine:download-event",
                    json!({ "jobId": job_id, "type": "canceled", "message": message }),
                );
                Ok(DownloadResponse {
                    job_id,
                    result: json!({ "type": "canceled", "message": message }),
                })
            } else {
                let _ = app.emit(
                    "engine:download-event",
                    json!({ "jobId": job_id, "type": "error", "error": message }),
                );
                Ok(DownloadResponse {
                    job_id,
                    result: json!({ "type": "error", "error": message }),
                })
            }
        }
    }
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, job_id: String) -> Result<Value, String> {
    let mut jobs = state.jobs.lock().await;
    if let Some(child) = jobs.get_mut(&job_id) {
        let _ = child.start_kill();
        jobs.remove(&job_id);
        Ok(json!({ "ok": true, "jobId": job_id }))
    } else {
        Ok(json!({ "ok": false, "jobId": job_id, "error": "Download is not running." }))
    }
}

/// Clamps a requested output-root override to the real configured root: an
/// override outside the root is silently ignored rather than erroring,
/// mirroring electron/libraryIpc.ts's `library:list` handler.
fn guarded_output_root(app: &AppHandle, requested: Option<String>) -> String {
    let root = current_output_root(app);
    match requested.map(|r| r.trim().to_string()).filter(|r| !r.is_empty()) {
        Some(requested) => crate::path_guard::resolve_within_roots(&requested, &[root.clone()])
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(root),
        None => root,
    }
}

#[tauri::command]
pub async fn library_list(app: AppHandle, output_root: Option<String>) -> Result<Value, String> {
    let root = guarded_output_root(&app, output_root);
    run_engine(
        &app,
        vec!["library-list".to_string(), "--output-root".to_string(), root],
        |_| {},
        None,
    )
    .await
}

#[tauri::command]
pub async fn failures_list(app: AppHandle, output_root: Option<String>) -> Result<Value, String> {
    let root = guarded_output_root(&app, output_root);
    run_engine(
        &app,
        vec!["failures-list".to_string(), "--output-root".to_string(), root],
        |_| {},
        None,
    )
    .await
}
