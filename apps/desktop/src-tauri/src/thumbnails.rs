// Rust port of apps/desktop/electron/thumbnails.ts (remote-URL fetch) and the
// thumbnail half of apps/desktop/electron/libraryIpc.ts (local media frame
// extraction via ffmpeg). Two Tauri commands:
//   - `load_thumbnail`: fetch the first working thumbnail URL out of a
//     candidate list reported by site metadata (queue cards).
//   - `load_library_thumbnail`: extract a frame from a downloaded file inside
//     the output root (Library grid), with an mtime-keyed LRU cache.

use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::path_guard::resolve_within_roots;
use crate::settings::current_output_root;

const MAX_THUMBNAIL_BYTES: usize = 5 * 1024 * 1024;
const MAX_THUMBNAIL_CANDIDATES: usize = 8;
const MAX_URL_LEN: usize = 4096;
const THUMBNAIL_MAX_DIMENSION: u32 = 320;
const THUMBNAIL_CACHE_LIMIT: usize = 500;
const FFMPEG_TIMEOUT_SECS: u64 = 10;

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "webm", "mkv", "mov", "avi", "ts", "m2ts"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "avif", "heic"];

// --- Remote thumbnail fetch -------------------------------------------------

#[derive(Serialize, Clone)]
pub struct ThumbnailLoadResult {
    pub src: Option<String>,
    pub url: Option<String>,
}

/// Dedup, cap, and validate candidate thumbnail URLs. Only http(s) URLs
/// survive; anything unparsable, oversized, or non-web-scheme is dropped.
/// Never trust the renderer's own filtering — this runs again here.
pub fn sanitize_thumbnail_urls(values: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in values {
        if item.len() > MAX_URL_LEN {
            continue;
        }
        let Ok(parsed) = url::Url::parse(item) else { continue };
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            continue;
        }
        let normalized = parsed.to_string();
        if !seen.insert(normalized.clone()) {
            continue;
        }
        out.push(normalized);
        if out.len() >= MAX_THUMBNAIL_CANDIDATES {
            break;
        }
    }
    out
}

fn thumbnail_headers(url: &str) -> Vec<(&'static str, String)> {
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    let mut headers = vec![
        ("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8".to_string()),
        (
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Rippopotamus/1.0 Safari/537.36"
                .to_string(),
        ),
    ];
    if host.contains("cdninstagram.com") || host.contains("fbcdn.net") {
        headers.push(("Referer", "https://www.instagram.com/".to_string()));
    }
    headers
}

async fn fetch_thumbnail_data_url(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let mut request = client.get(url);
    for (name, value) in thumbnail_headers(url) {
        request = request.header(name, value);
    }
    let response = request
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Thumbnail request failed: {}", response.status().as_u16()));
    }

    if let Some(len) = response.content_length() {
        if len as usize > MAX_THUMBNAIL_BYTES {
            return Err("Thumbnail is too large.".to_string());
        }
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    if !content_type.to_lowercase().starts_with("image/") {
        return Err(format!("Thumbnail is not an image: {content_type}"));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err("Thumbnail is too large.".to_string());
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{content_type};base64,{encoded}"))
}

#[tauri::command]
pub async fn load_thumbnail(urls: Vec<String>) -> ThumbnailLoadResult {
    let client = reqwest::Client::new();
    for url in sanitize_thumbnail_urls(&urls) {
        if let Ok(src) = fetch_thumbnail_data_url(&client, &url).await {
            return ThumbnailLoadResult { src: Some(src), url: Some(url) };
        }
    }
    ThumbnailLoadResult { src: None, url: None }
}

// --- Local library thumbnail (ffmpeg frame extraction) ----------------------

#[derive(Serialize, Clone)]
pub struct LibraryThumbnailResult {
    pub ok: bool,
    #[serde(rename = "dataUrl", skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct CacheEntry {
    mtime_ms: u128,
    data_url: String,
}

/// Insertion-ordered mtime-keyed LRU, same eviction shape as the Electron
/// `Map`-based cache: an existing key gets deleted-then-reinserted to refresh
/// recency, and the oldest entry (first when iterating) is evicted once the
/// cache exceeds the limit.
#[derive(Default)]
pub struct ThumbnailCache {
    entries: Mutex<HashMap<String, CacheEntry>>,
    order: Mutex<Vec<String>>,
}

impl ThumbnailCache {
    fn get(&self, key: &str, mtime_ms: u128) -> Option<String> {
        let entries = self.entries.lock().unwrap();
        let entry = entries.get(key)?;
        if entry.mtime_ms == mtime_ms {
            Some(entry.data_url.clone())
        } else {
            None
        }
    }

    fn set(&self, key: String, mtime_ms: u128, data_url: String) {
        let mut entries = self.entries.lock().unwrap();
        let mut order = self.order.lock().unwrap();
        entries.insert(key.clone(), CacheEntry { mtime_ms, data_url });
        order.retain(|k| k != &key);
        order.push(key);
        while order.len() > THUMBNAIL_CACHE_LIMIT {
            let oldest = order.remove(0);
            entries.remove(&oldest);
        }
    }
}

fn media_kind(target: &Path) -> &'static str {
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        "video"
    } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        "image"
    } else {
        "other"
    }
}

async fn ffmpeg_thumbnail_data_url(app: &AppHandle, safe: &Path, is_video: bool) -> Result<String, String> {
    let ffmpeg = crate::engine::ffmpeg_path(app).ok_or_else(|| "ffmpeg is unavailable.".to_string())?;
    let tmp_dir = app.path().temp_dir().unwrap_or_else(|_| std::env::temp_dir());
    ffmpeg_thumbnail_data_url_with(&ffmpeg, &tmp_dir, safe, is_video).await
}

/// AppHandle-free core so it can be exercised directly (see
/// `verify_support`) without spinning up a full Tauri app context.
async fn ffmpeg_thumbnail_data_url_with(ffmpeg: &str, tmp_dir: &Path, safe: &Path, is_video: bool) -> Result<String, String> {
    let tmp_file = tmp_dir.join(format!(
        "rippo-thumb-{}-{}-{}.png",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        uuid::Uuid::new_v4()
    ));

    let mut args: Vec<String> = Vec::new();
    if is_video {
        args.push("-ss".into());
        args.push("1".into());
    }
    args.push("-i".into());
    args.push(safe.to_string_lossy().to_string());
    args.push("-frames:v".into());
    args.push("1".into());
    args.push("-vf".into());
    args.push(format!("scale={THUMBNAIL_MAX_DIMENSION}:-1"));
    args.push("-y".into());
    args.push(tmp_file.to_string_lossy().to_string());

    let mut command = tokio::process::Command::new(&ffmpeg);
    command.args(&args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());

    let child = command.spawn().map_err(|e| e.to_string())?;
    let cleanup = |path: &Path| {
        let _ = std::fs::remove_file(path);
    };

    let output = tokio::time::timeout(std::time::Duration::from_secs(FFMPEG_TIMEOUT_SECS), child.wait_with_output()).await;
    let output = match output {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => {
            cleanup(&tmp_file);
            return Err("ffmpeg timed out.".to_string());
        }
    };
    let status = match output {
        Ok(o) => o.status,
        Err(e) => {
            cleanup(&tmp_file);
            return Err(e);
        }
    };
    if !status.success() {
        cleanup(&tmp_file);
        return Err(format!("ffmpeg exited with code {}", status.code().unwrap_or(-1)));
    }

    let bytes = std::fs::read(&tmp_file);
    cleanup(&tmp_file);
    let bytes = bytes.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("ffmpeg produced an empty frame.".to_string());
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}

async fn generate_thumbnail(app: &AppHandle, safe: &Path) -> LibraryThumbnailResult {
    let kind = media_kind(safe);
    if kind != "video" && kind != "image" {
        return LibraryThumbnailResult { ok: false, data_url: None, error: Some("No thumbnail available.".to_string()) };
    }
    match ffmpeg_thumbnail_data_url(app, safe, kind == "video").await {
        Ok(data_url) => LibraryThumbnailResult { ok: true, data_url: Some(data_url), error: None },
        Err(error) => LibraryThumbnailResult { ok: false, data_url: None, error: Some(error) },
    }
}

#[tauri::command]
pub async fn load_library_thumbnail(
    app: AppHandle,
    cache: State<'_, ThumbnailCache>,
    target: String,
) -> Result<LibraryThumbnailResult, ()> {
    let root = current_output_root(&app);
    let safe = match resolve_within_roots(&target, &[root]) {
        Some(path) => path,
        None => return Ok(LibraryThumbnailResult { ok: false, data_url: None, error: Some("Outside library.".to_string()) }),
    };

    let metadata = match std::fs::metadata(&safe) {
        Ok(m) => m,
        Err(e) => return Ok(LibraryThumbnailResult { ok: false, data_url: None, error: Some(e.to_string()) }),
    };
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let key = safe.to_string_lossy().to_string();
    if let Some(data_url) = cache.get(&key, mtime_ms) {
        return Ok(LibraryThumbnailResult { ok: true, data_url: Some(data_url), error: None });
    }

    let result = generate_thumbnail(&app, &safe).await;
    if result.ok {
        if let Some(data_url) = &result.data_url {
            cache.set(key, mtime_ms, data_url.clone());
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_and_https_urls() {
        assert_eq!(
            sanitize_thumbnail_urls(&[
                "https://example.com/a.jpg".to_string(),
                "http://example.com/b.jpg".to_string(),
            ]),
            vec!["https://example.com/a.jpg".to_string(), "http://example.com/b.jpg".to_string()],
        );
    }

    #[test]
    fn rejects_non_web_protocols() {
        assert_eq!(
            sanitize_thumbnail_urls(&[
                "file:///etc/passwd".to_string(),
                "data:image/png;base64,abcd".to_string(),
                "https://example.com/a.jpg".to_string(),
            ]),
            vec!["https://example.com/a.jpg".to_string()],
        );
    }

    #[test]
    fn deduplicates_candidates() {
        assert_eq!(
            sanitize_thumbnail_urls(&[
                "https://example.com/a.jpg".to_string(),
                "https://example.com/a.jpg".to_string(),
            ]),
            vec!["https://example.com/a.jpg".to_string()],
        );
    }

    #[test]
    fn caps_candidate_count_at_eight() {
        let urls: Vec<String> = (0..20).map(|i| format!("https://example.com/{i}.jpg")).collect();
        assert_eq!(sanitize_thumbnail_urls(&urls).len(), MAX_THUMBNAIL_CANDIDATES);
    }

    #[test]
    fn rejects_urls_over_the_length_cap() {
        let long_url = format!("https://example.com/{}.jpg", "a".repeat(MAX_URL_LEN));
        assert!(sanitize_thumbnail_urls(&[long_url]).is_empty());
    }

    #[test]
    fn drops_unparsable_entries() {
        assert!(sanitize_thumbnail_urls(&["not a url".to_string()]).is_empty());
    }

    #[test]
    fn media_kind_classifies_by_extension() {
        assert_eq!(media_kind(Path::new("/a/clip.MP4")), "video");
        assert_eq!(media_kind(Path::new("/a/pic.png")), "image");
        assert_eq!(media_kind(Path::new("/a/doc.pdf")), "other");
    }

    #[test]
    fn cache_evicts_oldest_entry_past_the_limit() {
        let cache = ThumbnailCache::default();
        for i in 0..(THUMBNAIL_CACHE_LIMIT + 5) {
            cache.set(format!("/a/{i}.mp4"), 1, format!("data:{i}"));
        }
        assert!(cache.get("/a/0.mp4", 1).is_none());
        assert!(cache.get(&format!("/a/{}.mp4", THUMBNAIL_CACHE_LIMIT + 4), 1).is_some());
    }

    #[test]
    fn cache_rejects_stale_mtime() {
        let cache = ThumbnailCache::default();
        cache.set("/a/x.mp4".to_string(), 1, "data:1".to_string());
        assert!(cache.get("/a/x.mp4", 2).is_none());
        assert_eq!(cache.get("/a/x.mp4", 1), Some("data:1".to_string()));
    }
}

/// Real-world verification hooks (see `examples/verify_thumbnails.rs`) that
/// exercise the exact same code paths as the Tauri commands above, minus the
/// `AppHandle`/managed-state plumbing that requires a running app.
pub mod verify_support {
    use super::{fetch_thumbnail_data_url, ffmpeg_thumbnail_data_url_with, sanitize_thumbnail_urls};
    use std::path::Path;

    pub async fn generate_local_for_verify(ffmpeg_bin: &str, video_path: &str) -> Result<String, String> {
        let tmp_dir = std::env::temp_dir();
        ffmpeg_thumbnail_data_url_with(ffmpeg_bin, &tmp_dir, Path::new(video_path), true).await
    }

    pub async fn fetch_remote_for_verify(url: &str) -> Result<(String, String), String> {
        let candidates = sanitize_thumbnail_urls(&[url.to_string()]);
        let sanitized = candidates.into_iter().next().ok_or_else(|| "URL rejected by sanitizer.".to_string())?;
        let client = reqwest::Client::new();
        let src = fetch_thumbnail_data_url(&client, &sanitized).await?;
        Ok((src, sanitized))
    }
}
