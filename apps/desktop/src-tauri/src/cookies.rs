// Rust port of apps/desktop/electron/cookies.ts + cookiesIpc.ts.
//
// The actual cookie READ stays yt-dlp's `--cookies-from-browser` flag,
// engine-side — this module only detects installed browsers and validates /
// persists which one (if any) is selected as the default cookie source.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserInfo {
    pub id: String,
    pub label: String,
    #[serde(rename = "appPath")]
    pub app_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum CookieSource {
    Off,
    Browser { #[serde(rename = "browserId")] browser_id: String },
}

impl Default for CookieSource {
    fn default() -> Self {
        CookieSource::Off
    }
}

pub fn validate_cookies_browser_id(
    browser_id: Option<&str>,
    browsers: &[BrowserInfo],
) -> Result<Option<String>, String> {
    let Some(id) = browser_id else { return Ok(None) };
    if browsers.iter().any(|b| b.id == id) {
        Ok(Some(id.to_string()))
    } else {
        Err("Unsupported browser selection.".to_string())
    }
}

pub fn cookie_source_browser_id(source: &CookieSource) -> Option<String> {
    match source {
        CookieSource::Browser { browser_id } => Some(browser_id.clone()),
        CookieSource::Off => None,
    }
}

pub fn cookie_source_from_browser_id(
    browser_id: Option<&str>,
    browsers: &[BrowserInfo],
) -> Result<CookieSource, String> {
    Ok(match validate_cookies_browser_id(browser_id, browsers)? {
        Some(id) => CookieSource::Browser { browser_id: id },
        None => CookieSource::Off,
    })
}

/// Returns the yt-dlp CLI args for a cookie source (mirrors
/// `cookieSourceArgs` in electron/cookiesIpc.ts).
pub fn cookie_source_args(source: &CookieSource) -> Vec<String> {
    match source {
        CookieSource::Browser { browser_id } => {
            vec!["--cookies-browser".to_string(), browser_id.clone()]
        }
        CookieSource::Off => vec![],
    }
}

pub fn cookies_supported() -> bool {
    cfg!(target_os = "macos")
}

struct BrowserCandidate {
    id: &'static str,
    label: &'static str,
    bundles: &'static [&'static str],
}

const CANDIDATES: &[BrowserCandidate] = &[
    BrowserCandidate { id: "chrome", label: "Chrome", bundles: &["Google Chrome.app", "Google Chrome Canary.app"] },
    BrowserCandidate { id: "safari", label: "Safari", bundles: &["Safari.app"] },
    BrowserCandidate { id: "firefox", label: "Firefox", bundles: &["Firefox.app", "Firefox Developer Edition.app"] },
    BrowserCandidate { id: "brave", label: "Brave", bundles: &["Brave Browser.app"] },
    BrowserCandidate { id: "edge", label: "Edge", bundles: &["Microsoft Edge.app"] },
    BrowserCandidate { id: "vivaldi", label: "Vivaldi", bundles: &["Vivaldi.app"] },
    BrowserCandidate { id: "opera", label: "Opera", bundles: &["Opera.app"] },
    BrowserCandidate { id: "chromium", label: "Chromium", bundles: &["Chromium.app"] },
];

pub fn detect_browsers(app: &AppHandle) -> Vec<BrowserInfo> {
    if !cookies_supported() {
        return vec![];
    }
    let home = app.path().home_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let roots = vec![PathBuf::from("/Applications"), home.join("Applications")];
    let mut found = vec![];
    for candidate in CANDIDATES {
        'bundles: for bundle in candidate.bundles {
            for root in &roots {
                let p = root.join(bundle);
                if p.exists() {
                    found.push(BrowserInfo {
                        id: candidate.id.to_string(),
                        label: candidate.label.to_string(),
                        app_path: p.to_string_lossy().to_string(),
                    });
                    break 'bundles;
                }
            }
        }
    }
    found
}

#[derive(Serialize)]
pub struct CookiesResponse {
    pub browsers: Vec<BrowserInfo>,
    pub selected: Option<String>,
    pub source: CookieSource,
    pub supported: bool,
}

pub fn cookies_response(app: &AppHandle, browsers: Vec<BrowserInfo>) -> CookiesResponse {
    let source = crate::settings::default_cookie_source(app, &browsers);
    CookiesResponse {
        selected: cookie_source_browser_id(&source),
        source,
        supported: cookies_supported(),
        browsers,
    }
}

#[tauri::command]
pub fn list_cookie_browsers(app: AppHandle) -> CookiesResponse {
    let browsers = detect_browsers(&app);
    cookies_response(&app, browsers)
}

#[tauri::command]
pub fn set_default_cookie_source(app: AppHandle, source: serde_json::Value) -> Result<CookiesResponse, String> {
    let browsers = detect_browsers(&app);
    let parsed = crate::settings::parse_cookie_source(&source, &browsers)?;
    let mut settings = crate::settings::read_settings(&app);
    settings.cookie_source = Some(parsed);
    settings.cookies_browser = None;
    crate::settings::write_settings(&app, &settings)?;
    Ok(cookies_response(&app, browsers))
}

#[tauri::command]
pub fn set_cookies_browser(app: AppHandle, browser_id: Option<String>) -> Result<CookiesResponse, String> {
    let browsers = detect_browsers(&app);
    let selected = validate_cookies_browser_id(browser_id.as_deref(), &browsers)?;
    let mut settings = crate::settings::read_settings(&app);
    settings.cookie_source = Some(match &selected {
        Some(id) => CookieSource::Browser { browser_id: id.clone() },
        None => CookieSource::Off,
    });
    settings.cookies_browser = None;
    crate::settings::write_settings(&app, &settings)?;
    Ok(cookies_response(&app, browsers))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn browsers() -> Vec<BrowserInfo> {
        vec![
            BrowserInfo { id: "chrome".to_string(), label: "Chrome".to_string(), app_path: "/Applications/Google Chrome.app".to_string() },
            BrowserInfo { id: "safari".to_string(), label: "Safari".to_string(), app_path: "/Applications/Safari.app".to_string() },
        ]
    }

    #[test]
    fn validate_cookies_browser_id_accepts_none() {
        assert_eq!(validate_cookies_browser_id(None, &browsers()), Ok(None));
    }

    #[test]
    fn validate_cookies_browser_id_accepts_detected_browser_ids() {
        assert_eq!(validate_cookies_browser_id(Some("chrome"), &browsers()), Ok(Some("chrome".to_string())));
    }

    #[test]
    fn validate_cookies_browser_id_rejects_arbitrary_input() {
        assert_eq!(
            validate_cookies_browser_id(Some("../../../cookies.txt"), &browsers()),
            Err("Unsupported browser selection.".to_string())
        );
    }

    #[test]
    fn cookie_source_from_browser_id_normalizes_off_and_browser_sources() {
        assert_eq!(cookie_source_from_browser_id(None, &browsers()), Ok(CookieSource::Off));
        assert_eq!(
            cookie_source_from_browser_id(Some("safari"), &browsers()),
            Ok(CookieSource::Browser { browser_id: "safari".to_string() })
        );
    }
}
