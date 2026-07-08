// Rust port of apps/desktop/electron/appUpdatesIpc.ts. Hits GitHub
// `releases/latest` for this repo, matches the platform asset (.dmg/.exe),
// and reports the same shape the UI expects. Opens the release/asset URL via
// tauri-plugin-opener.

use crate::version::{compare_versions, normalize_version};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

const GITHUB_RELEASES_LATEST: &str = "https://api.github.com/repos/Hellodebasishsahu/Rippopotamus/releases/latest";

#[derive(Serialize, Clone)]
pub struct AppUpdateInfo {
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    #[serde(rename = "latestVersion")]
    pub latest_version: Option<String>,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    pub configured: bool,
    #[serde(rename = "manifestUrl")]
    pub manifest_url: Option<String>,
    #[serde(rename = "dmgUrl")]
    pub dmg_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    pub notes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn validate_url(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let parsed = url::Url::parse(raw).ok()?;
    if parsed.scheme() == "http" || parsed.scheme() == "https" {
        Some(parsed.to_string())
    } else {
        None
    }
}

/// Dev override: RIPPO_APP_UPDATE_MANIFEST_URL, same as Electron's env hook.
fn configured_manifest_url() -> Result<Option<String>, String> {
    let raw = std::env::var("RIPPO_APP_UPDATE_MANIFEST_URL").unwrap_or_default();
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let parsed = url::Url::parse(raw).map_err(|_| "App update manifest must be an http or https URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("App update manifest must be an http or https URL.".to_string());
    }
    Ok(Some(parsed.to_string()))
}

async fn check_via_github(current_version: &str) -> AppUpdateInfo {
    let client = reqwest::Client::new();
    let response = match client
        .get(GITHUB_RELEASES_LATEST)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Rippopotamus")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return AppUpdateInfo {
                current_version: current_version.to_string(),
                latest_version: None,
                update_available: false,
                configured: true,
                manifest_url: Some(GITHUB_RELEASES_LATEST.to_string()),
                dmg_url: None,
                date: None,
                notes: vec![],
                error: Some(error.to_string()),
            };
        }
    };

    if response.status().as_u16() == 404 {
        // No releases published yet — report current version as latest.
        return AppUpdateInfo {
            current_version: current_version.to_string(),
            latest_version: None,
            update_available: false,
            configured: true,
            manifest_url: Some(GITHUB_RELEASES_LATEST.to_string()),
            dmg_url: None,
            date: None,
            notes: vec![],
            error: None,
        };
    }

    if !response.status().is_success() {
        return AppUpdateInfo {
            current_version: current_version.to_string(),
            latest_version: None,
            update_available: false,
            configured: true,
            manifest_url: Some(GITHUB_RELEASES_LATEST.to_string()),
            dmg_url: None,
            date: None,
            notes: vec![],
            error: Some(format!("App update check failed: {}", response.status().as_u16())),
        };
    }

    let release: Value = match response.json().await {
        Ok(r) => r,
        Err(error) => {
            return AppUpdateInfo {
                current_version: current_version.to_string(),
                latest_version: None,
                update_available: false,
                configured: true,
                manifest_url: Some(GITHUB_RELEASES_LATEST.to_string()),
                dmg_url: None,
                date: None,
                notes: vec![],
                error: Some(error.to_string()),
            };
        }
    };

    let latest_version = normalize_version(release.get("tag_name").and_then(Value::as_str));
    let asset_suffix = if cfg!(target_os = "windows") { ".exe" } else { ".dmg" };
    let asset_url = release
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets.iter().find(|a| {
                a.get("name")
                    .and_then(Value::as_str)
                    .map(|n| n.to_lowercase().ends_with(asset_suffix))
                    .unwrap_or(false)
            })
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(Value::as_str);
    let dmg_url = validate_url(asset_url).or_else(|| validate_url(release.get("html_url").and_then(Value::as_str)));

    let update_available = latest_version
        .as_deref()
        .zip(dmg_url.as_ref())
        .map(|(latest, _)| compare_versions(latest, current_version) > 0)
        .unwrap_or(false);

    let date = release
        .get("published_at")
        .and_then(Value::as_str)
        .map(|s| s.chars().take(10).collect());

    let notes = release
        .get("body")
        .and_then(Value::as_str)
        .map(|body| {
            body.lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .take(10)
                .collect()
        })
        .unwrap_or_default();

    AppUpdateInfo {
        current_version: current_version.to_string(),
        latest_version,
        update_available,
        configured: true,
        manifest_url: Some(GITHUB_RELEASES_LATEST.to_string()),
        dmg_url,
        date,
        notes,
        error: None,
    }
}

async fn check_via_manifest(current_version: &str, manifest_url: &str) -> AppUpdateInfo {
    let client = reqwest::Client::new();
    let result: Result<AppUpdateInfo, String> = async {
        let response = client
            .get(manifest_url)
            .header("Accept", "application/json")
            .header("User-Agent", "Rippopotamus")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("App update check failed: {}", response.status().as_u16()));
        }
        let manifest: Value = response.json().await.map_err(|e| e.to_string())?;
        let latest_version = normalize_version(manifest.get("version").and_then(Value::as_str));
        let dmg_url = validate_url(manifest.get("dmgUrl").and_then(Value::as_str));
        let update_available = latest_version
            .as_deref()
            .zip(dmg_url.as_ref())
            .map(|(latest, _)| compare_versions(latest, current_version) > 0)
            .unwrap_or(false);
        let notes = manifest
            .get("notes")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        Ok(AppUpdateInfo {
            current_version: current_version.to_string(),
            latest_version,
            update_available,
            configured: true,
            manifest_url: Some(manifest_url.to_string()),
            dmg_url,
            date: manifest.get("date").and_then(Value::as_str).map(String::from),
            notes,
            error: None,
        })
    }
    .await;

    result.unwrap_or_else(|error| AppUpdateInfo {
        current_version: current_version.to_string(),
        latest_version: None,
        update_available: false,
        configured: true,
        manifest_url: Some(manifest_url.to_string()),
        dmg_url: None,
        date: None,
        notes: vec![],
        error: Some(error),
    })
}

async fn check_app_update_core(app: &AppHandle) -> AppUpdateInfo {
    let current_version = app.package_info().version.to_string();
    let manifest_url = match configured_manifest_url() {
        Ok(url) => url,
        Err(error) => {
            return AppUpdateInfo {
                current_version,
                latest_version: None,
                update_available: false,
                configured: true,
                manifest_url: None,
                dmg_url: None,
                date: None,
                notes: vec![],
                error: Some(error),
            };
        }
    };

    match manifest_url {
        Some(url) => check_via_manifest(&current_version, &url).await,
        None => check_via_github(&current_version).await,
    }
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<AppUpdateInfo, String> {
    Ok(check_app_update_core(&app).await)
}
