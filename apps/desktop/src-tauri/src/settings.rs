// Rust port of apps/desktop/electron/settingsStore.ts. Persists user settings
// as JSON in Tauri's app config dir (Electron used `userData`; Tauri's
// `app_config_dir()` is the closest equivalent).

use crate::cookies::{cookie_source_from_browser_id, BrowserInfo, CookieSource};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    #[serde(rename = "cookieSource", skip_serializing_if = "Option::is_none")]
    pub cookie_source: Option<CookieSource>,
    #[serde(rename = "cookiesBrowser", skip_serializing_if = "Option::is_none")]
    pub cookies_browser: Option<String>,
    #[serde(rename = "outputRoot", skip_serializing_if = "Option::is_none")]
    pub output_root: Option<String>,
    #[serde(rename = "aria2MaxConnections", skip_serializing_if = "Option::is_none")]
    pub aria2_max_connections: Option<u32>,
    #[serde(rename = "aria2DownloadLimit", skip_serializing_if = "Option::is_none")]
    pub aria2_download_limit: Option<String>,
}

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("settings.json")
}

pub fn read_settings(app: &AppHandle) -> Settings {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn default_output_root(app: &AppHandle) -> PathBuf {
    app.path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("Rippo")
}

pub fn current_output_root(app: &AppHandle) -> String {
    let saved = read_settings(app).output_root;
    match saved {
        Some(value) if !value.trim().is_empty() => value,
        _ => default_output_root(app).to_string_lossy().to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferSettings {
    #[serde(rename = "aria2MaxConnections")]
    pub aria2_max_connections: u32,
    #[serde(rename = "aria2DownloadLimit")]
    pub aria2_download_limit: String,
}

pub fn normalize_aria2_max_connections(value: Option<f64>) -> u32 {
    match value {
        Some(v) if v.is_finite() => (v.floor() as i64).clamp(1, 16) as u32,
        _ => 8,
    }
}

pub fn normalize_aria2_download_limit(value: Option<&str>) -> String {
    let normalized: String = value.unwrap_or("").trim().chars().take(24).collect();
    if normalized.is_empty() {
        return String::new();
    }
    let valid = {
        let mut chars = normalized.chars().peekable();
        let mut has_digit = false;
        while let Some(&c) = chars.peek() {
            if c.is_ascii_digit() {
                has_digit = true;
                chars.next();
            } else {
                break;
            }
        }
        has_digit
            && match chars.next() {
                None => true,
                Some(c) if (c == 'K' || c == 'k' || c == 'M' || c == 'm') && chars.next().is_none() => true,
                _ => false,
            }
    };
    if valid {
        normalized.to_uppercase()
    } else {
        String::new()
    }
}

pub fn current_transfer_settings(app: &AppHandle) -> TransferSettings {
    let settings = read_settings(app);
    TransferSettings {
        aria2_max_connections: normalize_aria2_max_connections(settings.aria2_max_connections.map(|v| v as f64)),
        aria2_download_limit: normalize_aria2_download_limit(settings.aria2_download_limit.as_deref()),
    }
}

pub fn write_transfer_settings(
    app: &AppHandle,
    aria2_max_connections: Option<f64>,
    aria2_download_limit: Option<&str>,
) -> Result<TransferSettings, String> {
    let next = TransferSettings {
        aria2_max_connections: normalize_aria2_max_connections(aria2_max_connections),
        aria2_download_limit: normalize_aria2_download_limit(aria2_download_limit),
    };
    let mut settings = read_settings(app);
    settings.aria2_max_connections = Some(next.aria2_max_connections);
    if next.aria2_download_limit.is_empty() {
        settings.aria2_download_limit = None;
    } else {
        settings.aria2_download_limit = Some(next.aria2_download_limit.clone());
    }
    write_settings(app, &settings)?;
    Ok(next)
}

pub fn transfer_env(settings: &TransferSettings) -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("RIPPO_ARIA2_MAX_CONNECTIONS".to_string(), settings.aria2_max_connections.to_string());
    env.insert("RIPPO_ARIA2_DOWNLOAD_LIMIT".to_string(), settings.aria2_download_limit.clone());
    env
}

pub fn parse_cookie_source(value: &serde_json::Value, browsers: &[BrowserInfo]) -> Result<CookieSource, String> {
    if value.is_null() {
        return Ok(CookieSource::Off);
    }
    let obj = value.as_object().ok_or("Unsupported cookie source.")?;
    match obj.get("mode").and_then(|m| m.as_str()) {
        Some("off") => Ok(CookieSource::Off),
        Some("browser") => {
            let browser_id = obj
                .get("browserId")
                .and_then(|v| v.as_str())
                .ok_or("Unsupported cookie source.")?;
            cookie_source_from_browser_id(Some(browser_id), browsers)
        }
        _ => Err("Unsupported cookie source.".to_string()),
    }
}

pub fn default_cookie_source(app: &AppHandle, browsers: &[BrowserInfo]) -> CookieSource {
    let settings = read_settings(app);
    if let Some(source) = settings.cookie_source {
        // Re-validate against the currently detected browser list.
        let browser_id = crate::cookies::cookie_source_browser_id(&source);
        return cookie_source_from_browser_id(browser_id.as_deref(), browsers).unwrap_or(CookieSource::Off);
    }
    if let Some(browser_id) = settings.cookies_browser {
        return cookie_source_from_browser_id(Some(&browser_id), browsers).unwrap_or(CookieSource::Off);
    }
    CookieSource::Off
}

// --- Commands ---------------------------------------------------------------

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    read_settings(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    write_settings(&app, &settings)?;
    Ok(settings)
}

#[derive(Serialize)]
pub struct OutputRootChoice {
    #[serde(rename = "outputRoot")]
    output_root: String,
    canceled: bool,
}

#[tauri::command]
pub async fn choose_output_root(app: AppHandle) -> Result<OutputRootChoice, String> {
    use tauri_plugin_dialog::DialogExt;

    let current = current_output_root(&app);
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose download location")
        .set_directory(&current)
        .pick_folder(move |result| {
            let _ = tx.send(result);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    match picked {
        Some(path) => {
            let next = path.to_string();
            let mut settings = read_settings(&app);
            settings.output_root = Some(next.clone());
            write_settings(&app, &settings)?;
            Ok(OutputRootChoice { output_root: next, canceled: false })
        }
        None => Ok(OutputRootChoice { output_root: current, canceled: true }),
    }
}

#[derive(Serialize)]
pub struct OutputRootReset {
    #[serde(rename = "outputRoot")]
    output_root: String,
}

#[tauri::command]
pub fn reset_output_root(app: AppHandle) -> OutputRootReset {
    let mut settings = read_settings(&app);
    settings.output_root = None;
    let _ = write_settings(&app, &settings);
    OutputRootReset { output_root: default_output_root(&app).to_string_lossy().to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_aria2_max_connections() {
        assert_eq!(normalize_aria2_max_connections(None), 8);
        assert_eq!(normalize_aria2_max_connections(Some(0.0)), 1);
        assert_eq!(normalize_aria2_max_connections(Some(100.0)), 16);
        assert_eq!(normalize_aria2_max_connections(Some(4.9)), 4);
    }

    #[test]
    fn normalizes_aria2_download_limit() {
        assert_eq!(normalize_aria2_download_limit(Some("2M")), "2M");
        assert_eq!(normalize_aria2_download_limit(Some("500k")), "500K");
        assert_eq!(normalize_aria2_download_limit(Some("bogus")), "");
        assert_eq!(normalize_aria2_download_limit(None), "");
        assert_eq!(normalize_aria2_download_limit(Some("")), "");
    }

    fn browsers() -> Vec<BrowserInfo> {
        vec![BrowserInfo { id: "chrome".to_string(), label: "Chrome".to_string(), app_path: "/Applications/Google Chrome.app".to_string() }]
    }

    #[test]
    fn parse_cookie_source_accepts_structured_supported_sources() {
        assert_eq!(parse_cookie_source(&serde_json::json!(null), &browsers()), Ok(CookieSource::Off));
        assert_eq!(
            parse_cookie_source(&serde_json::json!({ "mode": "off" }), &browsers()),
            Ok(CookieSource::Off)
        );
        assert_eq!(
            parse_cookie_source(&serde_json::json!({ "mode": "browser", "browserId": "chrome" }), &browsers()),
            Ok(CookieSource::Browser { browser_id: "chrome".to_string() })
        );
    }

    #[test]
    fn parse_cookie_source_rejects_unsupported_shapes() {
        assert_eq!(
            parse_cookie_source(&serde_json::json!({ "mode": "browser", "browserId": "../../../cookies.txt" }), &browsers()),
            Err("Unsupported browser selection.".to_string())
        );
        assert_eq!(
            parse_cookie_source(&serde_json::json!("chrome"), &browsers()),
            Err("Unsupported cookie source.".to_string())
        );
    }
}
