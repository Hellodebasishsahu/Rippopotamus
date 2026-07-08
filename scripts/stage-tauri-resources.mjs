// Assembles the bundled binaries (frozen engine, ffmpeg, aria2c) into
// apps/desktop/src-tauri/resources/bin/ so tauri.conf.json's `bundle.resources`
// can pick them up as-is. Run after build-engine.sh + the ffmpeg/aria2c
// prepare scripts, before `tauri build`.
import fs from "node:fs";
import path from "node:path";

const [platform] = process.argv.slice(2);
if (!platform) {
  console.error("Usage: node scripts/stage-tauri-resources.mjs <darwin|win32|linux>");
  process.exit(1);
}

const root = process.cwd();
const exeSuffix = platform === "win32" ? ".exe" : "";
const target = path.join(root, "apps/desktop/src-tauri/resources/bin");

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

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

// Frozen engine: release/bin/rippo-engine/ (PyInstaller --onedir folder).
const engineSrc = path.join(root, "release/bin/rippo-engine");
requireDir(engineSrc, "frozen engine (run `npm run build:engine` first)");
requireFile(path.join(engineSrc, `rippo-engine${exeSuffix}`), "frozen engine executable");
fs.cpSync(engineSrc, path.join(target, "rippo-engine"), { recursive: true });

// ffmpeg-static's platform binary. npm workspaces hoist this to the repo
// root node_modules, but fall back to the desktop workspace's own copy in
// case hoisting ever changes.
const ffmpegCandidates = [
  path.join(root, "node_modules/ffmpeg-static", `ffmpeg${exeSuffix}`),
  path.join(root, "apps/desktop/node_modules/ffmpeg-static", `ffmpeg${exeSuffix}`),
];
const ffmpegSrc = ffmpegCandidates.find((p) => fs.existsSync(p));
if (!ffmpegSrc) fail(`Missing ffmpeg binary (run the prepare:ffmpeg:* script first): ${ffmpegCandidates.map((p) => path.relative(root, p)).join(" or ")}`);
fs.copyFileSync(ffmpegSrc, path.join(target, `ffmpeg${exeSuffix}`));
if (platform !== "win32") fs.chmodSync(path.join(target, `ffmpeg${exeSuffix}`), 0o755);

// Static aria2c staged by install-aria2c-resource.mjs.
const aria2cSrc = path.join(root, "build/bin", `aria2c${exeSuffix}`);
requireFile(aria2cSrc, "aria2c binary (run the prepare:aria2:* script first)");
fs.copyFileSync(aria2cSrc, path.join(target, `aria2c${exeSuffix}`));
if (platform !== "win32") fs.chmodSync(path.join(target, `aria2c${exeSuffix}`), 0o755);

console.log(`Staged Tauri resources at ${path.relative(root, target)}`);
