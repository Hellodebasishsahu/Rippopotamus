// Rust port of apps/desktop/electron/helperRegistry.ts. Checks/updates
// yt-dlp (GitHub releases) and gallery-dl (PyPI); ffmpeg/aria2c are
// reported but not updatable, same as Electron. Preserves the exact env
// contract (RIPPO_YTDLP_PATH, RIPPO_GALLERYDL_ROOT) the engine reads.

use crate::engine::{app_managed_gallerydl_root, app_managed_ytdlp_path, run_engine};
use crate::version::{compare_versions, normalize_version};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Serialize, Clone)]
pub struct HelperCheckResult {
    pub name: String,
    #[serde(rename = "currentVersion")]
    pub current_version: Option<String>,
    #[serde(rename = "latestVersion")]
    pub latest_version: Option<String>,
    pub updatable: bool,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct HelperUpdateResult {
    pub name: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn ytdlp_asset_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    }
}

async fn fetch_latest_ytdlp(client: &reqwest::Client) -> Result<(Option<String>, String), String> {
    let response = client
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Rippopotamus")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub release check failed: {}", response.status().as_u16()));
    }
    let release: Value = response.json().await.map_err(|e| e.to_string())?;
    let latest_version = normalize_version(release.get("tag_name").and_then(Value::as_str));
    let expected = ytdlp_asset_name();
    let asset_url = release
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets.iter().find(|a| a.get("name").and_then(Value::as_str) == Some(expected))
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(Value::as_str)
        .ok_or_else(|| "No yt-dlp release asset found for this platform.".to_string())?;
    Ok((latest_version, asset_url.to_string()))
}

async fn install_ytdlp(app: &AppHandle, client: &reqwest::Client, download_url: &str) -> Result<(), String> {
    let binary_path = app_managed_ytdlp_path(app);
    let bin_dir = binary_path.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let tmp_path = bin_dir.join(format!("{}.{}.tmp", binary_path.file_name().unwrap().to_string_lossy(), std::process::id()));

    let response = client
        .get(download_url)
        .header("User-Agent", "Rippopotamus")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("yt-dlp download failed: {}", response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&tmp_path, &bytes).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }

    std::fs::rename(&tmp_path, &binary_path).map_err(|e| e.to_string())
}

async fn fetch_latest_gallerydl(client: &reqwest::Client) -> Result<(Option<String>, String), String> {
    let response = client
        .get("https://pypi.org/pypi/gallery-dl/json")
        .header("Accept", "application/json")
        .header("User-Agent", "Rippopotamus")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("gallery-dl release check failed: {}", response.status().as_u16()));
    }
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let version = payload
        .get("info")
        .and_then(|i| i.get("version"))
        .and_then(Value::as_str)
        .ok_or("gallery-dl release check returned no version.")?;
    let latest_version = normalize_version(Some(version));
    let install_arg = latest_version.clone().unwrap_or_default();
    Ok((latest_version, install_arg))
}

async fn install_gallerydl(app: &AppHandle, version: &str) -> Result<(), String> {
    let target = app_managed_gallerydl_root(app);
    let tmp_target = target.with_file_name(format!("gallery-dl.{}.tmp", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_target);
    std::fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;

    run_engine(
        app,
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "install".to_string(),
            "--upgrade".to_string(),
            "--no-input".to_string(),
            "--disable-pip-version-check".to_string(),
            "--target".to_string(),
            tmp_target.to_string_lossy().to_string(),
            format!("gallery-dl=={version}"),
        ],
        |_| {},
        None,
    )
    .await?;

    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&tmp_target, &target).map_err(|e| e.to_string())
}

/// Reads the current versions the engine's `health` payload reports. Callers
/// pass this in so helpers.rs doesn't need to know how `health` is invoked.
pub type HealthPayload = Value;

fn read_current(health: &HealthPayload, key: &str) -> Option<String> {
    normalize_version(health.get(key).and_then(Value::as_str))
}

pub async fn check_all_helpers(app: &AppHandle, health: &HealthPayload) -> Vec<HelperCheckResult> {
    let client = reqwest::Client::new();

    let ytdlp_current = read_current(health, "ytDlp");
    let ytdlp = match fetch_latest_ytdlp(&client).await {
        Ok((latest, _)) => HelperCheckResult {
            name: "yt-dlp".into(),
            update_available: latest.as_deref().map_or(false, |l| {
                ytdlp_current.as_deref().map_or(true, |c| compare_versions(l, c) > 0)
            }),
            current_version: ytdlp_current,
            latest_version: latest,
            updatable: true,
            error: None,
        },
        Err(error) => HelperCheckResult {
            name: "yt-dlp".into(),
            current_version: ytdlp_current,
            latest_version: None,
            updatable: true,
            update_available: false,
            error: Some(error),
        },
    };

    let gallerydl_current = read_current(health, "galleryDl");
    let gallerydl = match fetch_latest_gallerydl(&client).await {
        Ok((latest, _)) => HelperCheckResult {
            name: "gallery-dl".into(),
            update_available: latest.as_deref().map_or(false, |l| {
                gallerydl_current.as_deref().map_or(true, |c| compare_versions(l, c) > 0)
            }),
            current_version: gallerydl_current,
            latest_version: latest,
            updatable: true,
            error: None,
        },
        Err(error) => HelperCheckResult {
            name: "gallery-dl".into(),
            current_version: gallerydl_current,
            latest_version: None,
            updatable: true,
            update_available: false,
            error: Some(error),
        },
    };

    let aria2c = HelperCheckResult {
        name: "aria2c".into(),
        current_version: health.get("aria2c").and_then(Value::as_str).map(String::from),
        latest_version: None,
        updatable: false,
        update_available: false,
        error: None,
    };

    let ffmpeg = HelperCheckResult {
        name: "ffmpeg".into(),
        current_version: health.get("ffmpegVersion").and_then(Value::as_str).map(String::from),
        latest_version: None,
        updatable: false,
        update_available: false,
        error: None,
    };

    let _ = app; // reserved for install paths below via update_all_helpers
    vec![ytdlp, gallerydl, aria2c, ffmpeg]
}

pub async fn update_all_helpers(app: &AppHandle, health: &HealthPayload) -> Vec<HelperUpdateResult> {
    let client = reqwest::Client::new();
    let mut results = vec![];

    let ytdlp_current = read_current(health, "ytDlp");
    match fetch_latest_ytdlp(&client).await {
        Ok((latest, install_arg)) => {
            let should_update = latest
                .as_deref()
                .map_or(false, |l| ytdlp_current.as_deref().map_or(true, |c| compare_versions(l, c) > 0));
            if should_update {
                match install_ytdlp(app, &client, &install_arg).await {
                    Ok(()) => results.push(HelperUpdateResult {
                        name: "yt-dlp".into(),
                        from: ytdlp_current,
                        to: latest,
                        ok: true,
                        error: None,
                    }),
                    Err(error) => results.push(HelperUpdateResult {
                        name: "yt-dlp".into(),
                        from: ytdlp_current,
                        to: None,
                        ok: false,
                        error: Some(error),
                    }),
                }
            }
        }
        Err(error) => results.push(HelperUpdateResult {
            name: "yt-dlp".into(),
            from: ytdlp_current,
            to: None,
            ok: false,
            error: Some(error),
        }),
    }

    let gallerydl_current = read_current(health, "galleryDl");
    match fetch_latest_gallerydl(&client).await {
        Ok((latest, install_arg)) => {
            let should_update = latest
                .as_deref()
                .map_or(false, |l| gallerydl_current.as_deref().map_or(true, |c| compare_versions(l, c) > 0));
            if should_update && !install_arg.is_empty() {
                match install_gallerydl(app, &install_arg).await {
                    Ok(()) => results.push(HelperUpdateResult {
                        name: "gallery-dl".into(),
                        from: gallerydl_current,
                        to: latest,
                        ok: true,
                        error: None,
                    }),
                    Err(error) => results.push(HelperUpdateResult {
                        name: "gallery-dl".into(),
                        from: gallerydl_current,
                        to: None,
                        ok: false,
                        error: Some(error),
                    }),
                }
            }
        }
        Err(error) => results.push(HelperUpdateResult {
            name: "gallery-dl".into(),
            from: gallerydl_current,
            to: None,
            ok: false,
            error: Some(error),
        }),
    }

    results
}

#[tauri::command]
pub async fn check_helpers(app: AppHandle) -> Result<Vec<HelperCheckResult>, String> {
    let health = crate::commands::health(app.clone()).await?;
    Ok(check_all_helpers(&app, &health).await)
}

#[tauri::command]
pub async fn update_helpers(app: AppHandle) -> Result<Vec<HelperUpdateResult>, String> {
    let health = crate::commands::health(app.clone()).await?;
    Ok(update_all_helpers(&app, &health).await)
}
