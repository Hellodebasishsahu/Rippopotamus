// Gate verification harnesses. Run the same command functions the frontend
// calls via `invoke()`, in-process, so each phase's gate can be exercised
// end-to-end without UI automation. `run` (P1, gated behind
// RIPPO_P1_SELFTEST=1) covers fetch -> download -> library_list; `run_p2`
// (gated behind RIPPO_P2_SELFTEST=1) covers settings/output-root, the path
// guard, the helper registry, and the app-update check. Neither is wired
// into the invoke_handler or shipped UI.

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

// P2 gate verification harness. Gated behind RIPPO_P2_SELFTEST=1. Exercises,
// through the same command functions the frontend invokes:
//   (a) output-root settings round-trip + a download landing at the new root
//   (b) the path guard rejecting an out-of-root path
//   (c) check_helpers hitting the real yt-dlp GitHub / gallery-dl PyPI APIs
//   (d) check_app_update hitting the real GitHub releases/latest API
pub async fn run_p2(app: AppHandle) {
    log::info!("[selftest-p2] starting P2 gate self-test");

    // (a) settings + output root.
    let custom_root = std::env::temp_dir().join(format!("rippo-p2-selftest-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&custom_root);
    let mut settings = crate::settings::read_settings(&app);
    settings.output_root = Some(custom_root.to_string_lossy().to_string());
    match crate::settings::write_settings(&app, &settings) {
        Ok(()) => log::info!("[selftest-p2] wrote settings with outputRoot={}", custom_root.display()),
        Err(e) => log::error!("[selftest-p2] write_settings FAILED: {e}"),
    }
    // Re-read from disk (no in-process cache exists) to confirm the write
    // round-trips the way it would across a real process restart.
    let reread = crate::settings::current_output_root(&app);
    if reread == custom_root.to_string_lossy() {
        log::info!("[selftest-p2] (a) output-root persistence: OK ({reread})");
    } else {
        log::error!("[selftest-p2] (a) output-root persistence FAILED: got {reread}");
    }

    let url = std::env::var("RIPPO_P1_SELFTEST_URL")
        .unwrap_or_else(|_| "https://archive.org/details/SampleVideo1280x7205mb".to_string());
    let state: tauri::State<AppState> = app.state();
    let payload: commands::DownloadRequest = serde_json::from_value(json!({
        "url": url,
        "preset": "mp4-best",
        "itemId": "selftestp2",
        "title": "Rippo P2 selftest",
    }))
    .expect("selftest download payload should deserialize");
    match commands::download(app.clone(), state, payload).await {
        Ok(response) => log::info!(
            "[selftest-p2] (a) download into custom root ok jobId={} result={}",
            response.job_id,
            response.result
        ),
        Err(e) => log::error!("[selftest-p2] (a) download into custom root FAILED: {e}"),
    }
    match std::fs::read_dir(&custom_root) {
        Ok(entries) => {
            let names: Vec<String> = entries.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string())).collect();
            log::info!("[selftest-p2] (a) custom root contents: {names:?}");
        }
        Err(e) => log::error!("[selftest-p2] (a) reading custom root FAILED: {e}"),
    }

    // (b) path guard.
    match crate::shell::open_path(app.clone(), "/etc/passwd".to_string()) {
        Ok(()) => log::error!("[selftest-p2] (b) path guard FAILED: open_path allowed an out-of-root path"),
        Err(e) => log::info!("[selftest-p2] (b) path guard rejected out-of-root path as expected: {e}"),
    }

    // (c) helper registry against real GitHub / PyPI.
    match crate::commands::health(app.clone()).await {
        Ok(health) => {
            let results = crate::helpers::check_all_helpers(&app, &health).await;
            for r in &results {
                log::info!(
                    "[selftest-p2] (c) helper={} current={:?} latest={:?} updateAvailable={} error={:?}",
                    r.name, r.current_version, r.latest_version, r.update_available, r.error
                );
            }
        }
        Err(e) => log::error!("[selftest-p2] (c) health FAILED before helper check: {e}"),
    }

    // (d) app-update check against real GitHub releases/latest.
    match crate::app_update::check_app_update(app.clone()).await {
        Ok(info) => log::info!(
            "[selftest-p2] (d) app update: current={} latest={:?} available={} dmgUrl={:?} error={:?}",
            info.current_version, info.latest_version, info.update_available, info.dmg_url, info.error
        ),
        Err(e) => log::error!("[selftest-p2] (d) check_app_update FAILED: {e}"),
    }

    let _ = std::fs::remove_dir_all(&custom_root);
    log::info!("[selftest-p2] P2 gate self-test complete");
}

// Thumbnail parity gate. Gated behind RIPPO_THUMBNAILS_SELFTEST=1. Exercises
// the real `load_library_thumbnail` / `load_thumbnail` commands (path guard,
// ffmpeg resolution, and mtime-keyed cache all included) against:
//   (a) a real video file placed at RIPPO_THUMBNAILS_SELFTEST_VIDEO (or a
//       synthetic ffmpeg-generated clip if unset) inside a temp output root
//   (b) a real public image URL at RIPPO_THUMBNAILS_SELFTEST_IMAGE_URL
pub async fn run_thumbnails(app: AppHandle) {
    log::info!("[selftest-thumbs] starting thumbnails gate self-test");

    let root = std::env::temp_dir().join(format!("rippo-thumbs-selftest-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&root);
    let mut settings = crate::settings::read_settings(&app);
    settings.output_root = Some(root.to_string_lossy().to_string());
    if let Err(e) = crate::settings::write_settings(&app, &settings) {
        log::error!("[selftest-thumbs] write_settings FAILED: {e}");
        return;
    }

    let video_path = match std::env::var("RIPPO_THUMBNAILS_SELFTEST_VIDEO") {
        Ok(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => {
            let generated = root.join("selftest-clip.mp4");
            let ffmpeg = crate::engine::ffmpeg_path(&app).unwrap_or_else(|| "ffmpeg".to_string());
            let status = std::process::Command::new(&ffmpeg)
                .args([
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=duration=2:size=320x240:rate=5",
                    "-pix_fmt",
                    "yuv420p",
                    generated.to_string_lossy().as_ref(),
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            match status {
                Ok(s) if s.success() => generated,
                other => {
                    log::error!("[selftest-thumbs] (a) could not generate a sample clip: {other:?}");
                    return;
                }
            }
        }
    };
    // Copy into the guarded output root if it isn't already there.
    let target = root.join(video_path.file_name().unwrap_or_default());
    if video_path != target {
        if let Err(e) = std::fs::copy(&video_path, &target) {
            log::error!("[selftest-thumbs] (a) copying sample clip into output root FAILED: {e}");
            return;
        }
    }

    let cache: tauri::State<crate::thumbnails::ThumbnailCache> = app.state();
    match crate::thumbnails::load_library_thumbnail(app.clone(), cache, target.to_string_lossy().to_string()).await {
        Ok(result) if result.ok => {
            let len = result.data_url.as_deref().map(str::len).unwrap_or(0);
            let prefix = result.data_url.as_deref().map(|s| &s[..s.find(',').unwrap_or(30).min(30)]).unwrap_or("");
            log::info!("[selftest-thumbs] (a) load_library_thumbnail OK: prefix={prefix} total_len={len}");
        }
        Ok(result) => log::error!("[selftest-thumbs] (a) load_library_thumbnail returned ok=false: {:?}", result.error),
        Err(e) => log::error!("[selftest-thumbs] (a) load_library_thumbnail FAILED: {e:?}"),
    }

    let image_url = std::env::var("RIPPO_THUMBNAILS_SELFTEST_IMAGE_URL")
        .unwrap_or_else(|_| "https://placehold.co/64x64.png".to_string());
    let result = crate::thumbnails::load_thumbnail(vec![image_url.clone()]).await;
    match &result.src {
        Some(src) => {
            let prefix = &src[..src.find(',').unwrap_or(30).min(30)];
            log::info!(
                "[selftest-thumbs] (b) load_thumbnail OK: url={:?} prefix={prefix} total_len={}",
                result.url,
                src.len()
            );
        }
        None => log::error!("[selftest-thumbs] (b) load_thumbnail FAILED to fetch {image_url}"),
    }

    let _ = std::fs::remove_dir_all(&root);
    log::info!("[selftest-thumbs] thumbnails gate self-test complete");
}
