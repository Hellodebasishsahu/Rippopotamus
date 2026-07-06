// Rust port of apps/desktop/electron/engineProcess.ts + engineIpc.ts (P1 core loop).
// Spawns the Python engine (or, once frozen, the PyInstaller --onedir binary)
// exactly as the Electron main process did, and streams its stdout JSON lines
// back to the caller.

use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

/// Repo root when running from source (three levels above `src-tauri`:
/// src-tauri -> apps/desktop -> apps -> repo root).
fn dev_repo_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or(manifest_dir)
}

fn is_packaged(app: &AppHandle) -> bool {
    // Dev runs point the frontend at the Vite dev server; packaged builds embed
    // frontendDist. `resource_dir()` only resolves to something meaningful once
    // bundled, so use the same signal Tauri itself uses: whether we're in a
    // `cargo tauri dev` / debug_assertions build.
    !cfg!(debug_assertions) && app.path().resource_dir().is_ok()
}

fn engine_cwd(app: &AppHandle) -> PathBuf {
    if is_packaged(app) {
        app.path().resource_dir().unwrap_or_else(|_| dev_repo_root())
    } else {
        dev_repo_root()
    }
}

fn resources_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|dir| dir.join("bin"))
}

fn bundled_engine_executable(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "rippo-engine.exe" } else { "rippo-engine" };
    let mut candidates = vec![];
    if let Ok(configured) = std::env::var("RIPPO_ENGINE_BINARY") {
        if !configured.trim().is_empty() {
            candidates.push(PathBuf::from(configured));
        }
    }
    if let Some(bin_dir) = resources_bin_dir(app) {
        // PyInstaller --onedir layout: bin/rippo-engine/rippo-engine(.exe) plus
        // an adjacent _internal/ directory the executable loads at runtime.
        candidates.push(bin_dir.join("rippo-engine").join(name));
    }
    candidates.into_iter().find(|p| p.exists())
}

fn candidate_pythons() -> Vec<String> {
    let mut out = vec![];
    if let Ok(configured) = std::env::var("RIPPO_PYTHON") {
        if !configured.trim().is_empty() {
            out.push(configured);
        }
    }
    if cfg!(windows) {
        out.extend(["py", "python", "python3"].map(String::from));
    } else {
        out.extend(
            [
                "/opt/homebrew/opt/python@3.13/libexec/bin/python",
                "/opt/homebrew/bin/python3",
                "python3",
                "python",
            ]
            .map(String::from),
        );
    }
    out
}

fn ffmpeg_path(app: &AppHandle) -> Option<String> {
    if let Ok(configured) = std::env::var("RIPPO_FFMPEG_PATH") {
        if !configured.trim().is_empty() {
            return Some(configured);
        }
    }
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Some(bin_dir) = resources_bin_dir(app) {
        let bundled = bin_dir.join(name);
        if bundled.exists() {
            return Some(bundled.to_string_lossy().to_string());
        }
    }
    // Dev fallback: ffmpeg-static's node_modules binary, the same one
    // electron-builder unpacked before the Tauri migration. npm workspaces
    // hoist it to the repo root; check that first, then the workspace itself.
    for candidate in [
        dev_repo_root().join("node_modules/ffmpeg-static").join(name),
        dev_repo_root().join("apps/desktop/node_modules/ffmpeg-static").join(name),
    ] {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

pub fn app_managed_ytdlp_path(app: &AppHandle) -> PathBuf {
    let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("bin")
        .join(name)
}

pub fn app_managed_gallerydl_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("python")
        .join("gallery-dl")
}

fn bundled_aria2c_path(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "aria2c.exe" } else { "aria2c" };
    resources_bin_dir(app).map(|dir| dir.join(name)).filter(|p| p.exists())
}

/// Build the child-process environment the same way `engineProcess.ts#engineEnv`
/// does: PYTHONPATH pointing at the (dev source | frozen resource) engine
/// package, plus the RIPPO_* helper-location overrides. Missing helpers are
/// left unset/empty; `desktop_runtime.py` already falls back to PATH lookups.
pub fn engine_env(app: &AppHandle) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();

    let python_path_dir = if is_packaged(app) {
        engine_cwd(app).join("engine")
    } else {
        dev_repo_root().join("src")
    };

    let gallerydl_root = app_managed_gallerydl_root(app);
    let gallerydl_root_str = if gallerydl_root.exists() {
        gallerydl_root.to_string_lossy().to_string()
    } else {
        String::new()
    };

    let existing_pythonpath = env.get("PYTHONPATH").cloned().unwrap_or_default();
    let mut pythonpath_parts = vec![];
    if !gallerydl_root_str.is_empty() {
        pythonpath_parts.push(gallerydl_root_str.clone());
    }
    pythonpath_parts.push(python_path_dir.to_string_lossy().to_string());
    if !existing_pythonpath.is_empty() {
        pythonpath_parts.push(existing_pythonpath);
    }
    let delimiter = if cfg!(windows) { ";" } else { ":" };
    env.insert("PYTHONPATH".into(), pythonpath_parts.join(delimiter));

    if let Some(ffmpeg) = ffmpeg_path(app) {
        env.insert("RIPPO_FFMPEG_PATH".into(), ffmpeg);
    }

    let ytdlp = app_managed_ytdlp_path(app);
    if let Some(parent) = ytdlp.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    env.entry("RIPPO_YTDLP_PATH".into())
        .or_insert_with(|| ytdlp.to_string_lossy().to_string());

    env.insert("RIPPO_GALLERYDL_ROOT".into(), gallerydl_root_str);

    if let Some(aria2c) = bundled_aria2c_path(app) {
        env.entry("RIPPO_ARIA2C_PATH".into())
            .or_insert_with(|| aria2c.to_string_lossy().to_string());
    }

    let transfer = crate::settings::current_transfer_settings(app);
    for (key, value) in crate::settings::transfer_env(&transfer) {
        env.insert(key, value);
    }

    env
}

fn error_message_from_json(payload: &Value) -> Option<String> {
    if !payload.is_object() {
        return None;
    }
    let record = payload.as_object().unwrap();
    let is_error_type = record.get("type").and_then(Value::as_str) == Some("error");
    let ok_false = record.get("ok").and_then(Value::as_bool) == Some(false);
    if !is_error_type && !ok_false {
        return None;
    }
    for key in ["error", "message", "reason"] {
        if let Some(text) = record.get(key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Job registry for in-flight `download` invocations, keyed by job id, so a
/// `cancel_download` command can reach in and kill the child process. Mirrors
/// the Electron `activeDownloads` map, but holds the actual `Child` (per the
/// LLD's `Mutex<HashMap<String, Child>>` design) instead of a cancel closure.
pub type ActiveJobs = std::sync::Arc<tokio::sync::Mutex<HashMap<String, Child>>>;

/// Spawns the engine (bundled onedir binary if present and packaged, else the
/// Python interpreter running `python -m rippopotamus.desktop_engine`) and
/// streams parsed JSON-line events to `on_json` as they arrive. Returns the
/// last JSON payload seen (the command's final result) once the process exits.
///
/// If `job_id` is set, the spawned child is registered in `jobs` for the
/// duration of the run so `cancel_download` can kill it; the entry is removed
/// again once the process exits.
pub async fn run_engine(
    app: &AppHandle,
    args: Vec<String>,
    mut on_json: impl FnMut(Value) + Send + 'static,
    jobs: Option<(ActiveJobs, String)>,
) -> Result<Value, String> {
    let env = engine_env(app);
    let cwd = engine_cwd(app);

    let mut child = if let Some(bundled) = bundled_engine_executable(app) {
        let mut cmd = Command::new(bundled);
        cmd.args(&args).envs(&env).current_dir(&cwd);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn().map_err(|e| e.to_string())?
    } else {
        let mut spawned: Option<Child> = None;
        let mut last_err = String::new();
        for python in candidate_pythons() {
            let mut full_args = vec!["-m".to_string(), "rippopotamus.desktop_engine".to_string()];
            full_args.extend(args.clone());
            let mut cmd = Command::new(&python);
            cmd.args(&full_args).envs(&env).current_dir(&cwd);
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
            match cmd.spawn() {
                Ok(child) => {
                    spawned = Some(child);
                    break;
                }
                Err(e) => last_err = format!("{python}: {e}"),
            }
        }
        spawned.ok_or_else(|| {
            if last_err.is_empty() {
                "No Python runtime found for the local engine.".to_string()
            } else {
                last_err
            }
        })?
    };

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    // Exhaustive if/else so `child` is moved on exactly one path — either into
    // the shared jobs map (for cancellation) or held locally below.
    let mut local_child: Option<Child> = None;
    if let Some((jobs, id)) = jobs.clone() {
        jobs.lock().await.insert(id, child);
    } else {
        local_child = Some(child);
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_leak = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(payload) => {
                    let _ = tx.send(payload);
                }
                Err(_) => {
                    stderr_leak.push_str(&line);
                    stderr_leak.push('\n');
                }
            }
        }
        stderr_leak
    });

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            collected.push_str(&line);
            collected.push('\n');
        }
        collected
    });

    let mut last_json: Option<Value> = None;
    while let Some(payload) = rx.recv().await {
        last_json = Some(payload.clone());
        on_json(payload);
    }

    // The child may now live only in the `jobs` map (if registered); wait on
    // it there so cancellation (which kills it in-place) is observed.
    let status = if let Some((jobs, id)) = jobs.clone() {
        let mut guard = jobs.lock().await;
        if let Some(child) = guard.get_mut(&id) {
            let status = child.wait().await.map_err(|e| e.to_string())?;
            guard.remove(&id);
            status
        } else {
            // Already removed (canceled) — treat as a kill.
            return Err("Download canceled.".to_string());
        }
    } else {
        local_child
            .expect("child held locally when not job-tracked")
            .wait()
            .await
            .map_err(|e| e.to_string())?
    };

    let stdout_stderr_leak = stdout_task.await.unwrap_or_default();
    let mut stderr_text = stderr_task.await.unwrap_or_default();
    stderr_text.push_str(&stdout_stderr_leak);

    if status.success() {
        return Ok(last_json.unwrap_or(Value::Null));
    }

    let message = last_json
        .as_ref()
        .and_then(error_message_from_json)
        .unwrap_or_else(|| {
            let trimmed = stderr_text.trim();
            if trimmed.is_empty() {
                format!("Engine exited with code {}", status.code().unwrap_or(-1))
            } else {
                trimmed.to_string()
            }
        });
    Err(message)
}
