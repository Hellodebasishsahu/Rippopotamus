import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const target = process.argv[2];
const root = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`Missing ${label}: ${path.relative(root, filePath)}`);
  }
}

function requireDir(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    fail(`Missing ${label}: ${path.relative(root, dirPath)}`);
  }
}

function packagePaths(packageTarget) {
  if (packageTarget === "win") {
    const resources = path.join(root, "release", "win-unpacked", "resources");
    return {
      platform: "win32",
      resources,
      engine: path.join(resources, "engine"),
      ffmpeg: path.join(resources, "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
      aria2c: path.join(resources, "bin", "aria2c.exe"),
    };
  }

  if (packageTarget === "mac") {
    const resources = path.join(root, "release", "mac-arm64", "Rippopotamus.app", "Contents", "Resources");
    return {
      platform: "darwin",
      resources,
      engine: path.join(resources, "engine"),
      ffmpeg: path.join(resources, "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg"),
      aria2c: path.join(resources, "bin", "aria2c"),
    };
  }

  // Tauri bundle layout: resources live directly under Contents/Resources
  // (mac) rather than behind an asar; the frozen engine + ffmpeg + aria2c
  // are staged by scripts/stage-tauri-resources.mjs into resources/bin/.
  if (packageTarget === "mac-tauri") {
    const resources = path.join(
      root,
      "apps/desktop/src-tauri/target/release/bundle/macos/Rippopotamus.app/Contents/Resources",
    );
    return {
      platform: "darwin",
      resources,
      ffmpeg: path.join(resources, "bin", "ffmpeg"),
      aria2c: path.join(resources, "bin", "aria2c"),
      bundledOnly: true,
    };
  }

  if (packageTarget === "win-tauri") {
    // Unlike macOS (resources land directly in the .app bundle), the NSIS
    // build output is just the installer .exe — resources are embedded in
    // it and only materialize once installed. CI runs the installer
    // silently first and passes the resulting install directory here.
    const resources = process.env.RIPPO_VERIFY_RESOURCES;
    if (!resources) {
      fail("win-tauri verification needs RIPPO_VERIFY_RESOURCES set to the installed app's resource directory.");
    }
    return {
      platform: "win32",
      resources,
      ffmpeg: path.join(resources, "bin", "ffmpeg.exe"),
      aria2c: path.join(resources, "bin", "aria2c.exe"),
      bundledOnly: true,
    };
  }

  fail("Usage: node scripts/verify-packaged-engine-health.mjs <mac|win|mac-tauri|win-tauri>");
}

function pythonCandidates() {
  if (process.platform === "win32") {
    return [
      { command: "py", args: ["-3"] },
      { command: "python", args: [] },
      { command: "python3", args: [] },
    ];
  }
  return [
    { command: "python", args: [] },
    { command: "python3", args: [] },
  ];
}

// A truly fresh install has no yt-dlp yet (the helper registry fetches it
// standalone from GitHub releases at runtime — see helpers.rs). Mirror that
// here with a real download so the bundled-only health check reflects what a
// first-run user would see once helpers are installed, not an empty-PATH
// failure that has nothing to do with packaging.
function fetchStandaloneYtDlp(platformName) {
  const assetName = platformName === "win32" ? "yt-dlp.exe" : "yt-dlp_macos";
  const cacheDir = path.join(root, ".build", "verify-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const dest = path.join(cacheDir, assetName);
  if (!fs.existsSync(dest)) {
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
    const result = spawnSync("curl", ["-fsSL", "-o", dest, url], { stdio: "inherit" });
    if (result.status !== 0) fail(`Could not fetch standalone yt-dlp from ${url} for verification.`);
    if (platformName !== "win32") fs.chmodSync(dest, 0o755);
  }
  return dest;
}

const paths = packagePaths(target);
if (process.platform !== paths.platform) {
  fail(`Packaged ${target} engine health must run on ${paths.platform}; current platform is ${process.platform}.`);
}

if (!paths.bundledOnly) {
  requireDir(paths.engine, "packaged engine resources");
  requireFile(path.join(paths.engine, "rippopotamus", "desktop_engine.py"), "packaged desktop engine");
}
requireFile(paths.ffmpeg, "packaged ffmpeg binary");
requireFile(paths.aria2c, "packaged aria2c binary");

const env = {
  ...process.env,
  PYTHONPATH: [paths.engine, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  RIPPO_FFMPEG_PATH: paths.ffmpeg,
  RIPPO_ARIA2C_PATH: paths.aria2c,
  RIPPO_YTDLP_PATH: paths.bundledOnly ? fetchStandaloneYtDlp(paths.platform) : "",
};

// PyInstaller --onedir layout: bin/rippo-engine/rippo-engine(.exe) plus an
// adjacent _internal/ the executable loads at runtime (see engine.rs).
const bundledEngineName = paths.platform === "win32" ? "rippo-engine.exe" : "rippo-engine";
const bundledEngine = path.join(paths.resources, "bin", "rippo-engine", bundledEngineName);
if (paths.bundledOnly) requireFile(bundledEngine, "packaged frozen engine executable");

if (fs.existsSync(bundledEngine)) {
  const bundledResult = spawnSync(bundledEngine, ["health"], {
    cwd: paths.resources,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (!bundledResult.error && bundledResult.status === 0) {
    let payload;
    try {
      payload = JSON.parse(bundledResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
    } catch {
      payload = {};
    }
    const actualAria2c = path.resolve(String(payload.aria2cPath || ""));
    const expectedAria2c = path.resolve(paths.aria2c);
    if (payload.ok && payload.ffmpegOk && payload.aria2cOk && actualAria2c === expectedAria2c) {
      console.log(`Packaged ${target} rippo-engine binary health is valid on ${os.platform()}.`);
      process.exit(0);
    }
    if (paths.bundledOnly) {
      fail(`Packaged frozen engine health did not pass: ${JSON.stringify(payload)}`);
    }
  } else if (paths.bundledOnly) {
    fail(`Packaged frozen engine failed to run: ${bundledResult.error?.message || bundledResult.stderr || bundledResult.stdout}`);
  }
  console.warn(`Note: ${path.relative(root, bundledEngine)} exists but health check did not pass; falling back to Python engine.`);
}

let lastError = "";
for (const candidate of pythonCandidates()) {
  const result = spawnSync(candidate.command, [...candidate.args, "-m", "rippopotamus.desktop_engine", "health"], {
    cwd: paths.resources,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    lastError = result.error.message;
    continue;
  }

  if (result.status !== 0) {
    lastError = result.stderr || result.stdout || `${candidate.command} exited with ${result.status}`;
    continue;
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
  } catch (error) {
    fail(`Packaged engine health returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!payload.ok) fail(`Packaged engine health is not ok: ${JSON.stringify(payload)}`);
  if (!payload.python) fail("Packaged engine health did not report Python.");
  if (!payload.ytDlp) fail("Packaged engine health did not report yt-dlp.");
  if (!payload.ffmpegOk) fail(`Packaged engine health did not accept ffmpeg: ${JSON.stringify(payload)}`);
  if (!payload.aria2cOk) fail(`Packaged engine health did not accept aria2c: ${JSON.stringify(payload)}`);

  const actualFfmpeg = path.resolve(String(payload.ffmpeg));
  const expectedFfmpeg = path.resolve(paths.ffmpeg);
  if (actualFfmpeg !== expectedFfmpeg) {
    fail(`Packaged engine used wrong ffmpeg. Expected ${expectedFfmpeg}, got ${actualFfmpeg}`);
  }

  const actualAria2c = path.resolve(String(payload.aria2cPath));
  const expectedAria2c = path.resolve(paths.aria2c);
  if (actualAria2c !== expectedAria2c) {
    fail(`Packaged engine used wrong aria2c. Expected ${expectedAria2c}, got ${actualAria2c}`);
  }

  console.log(`Packaged ${target} engine health is valid on ${os.platform()}.`);
  process.exit(0);
}

fail(`No usable Python runtime could run packaged ${target} engine health. Last error: ${lastError}`);
