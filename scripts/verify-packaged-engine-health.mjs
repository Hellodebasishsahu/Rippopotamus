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
    };
  }

  if (packageTarget === "mac") {
    const resources = path.join(root, "release", "mac-arm64", "Rippopotamus.app", "Contents", "Resources");
    return {
      platform: "darwin",
      resources,
      engine: path.join(resources, "engine"),
      ffmpeg: path.join(resources, "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg"),
    };
  }

  fail("Usage: node scripts/verify-packaged-engine-health.mjs <mac|win>");
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

const paths = packagePaths(target);
if (process.platform !== paths.platform) {
  fail(`Packaged ${target} engine health must run on ${paths.platform}; current platform is ${process.platform}.`);
}

requireDir(paths.engine, "packaged engine resources");
requireFile(path.join(paths.engine, "rippopotamus", "desktop_engine.py"), "packaged desktop engine");
requireFile(paths.ffmpeg, "packaged ffmpeg binary");

const env = {
  ...process.env,
  PYTHONPATH: [paths.engine, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  RIPPO_FFMPEG_PATH: paths.ffmpeg,
  RIPPO_YTDLP_PATH: "",
};

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

  const actualFfmpeg = path.resolve(String(payload.ffmpeg));
  const expectedFfmpeg = path.resolve(paths.ffmpeg);
  if (actualFfmpeg !== expectedFfmpeg) {
    fail(`Packaged engine used wrong ffmpeg. Expected ${expectedFfmpeg}, got ${actualFfmpeg}`);
  }

  console.log(`Packaged ${target} engine health is valid on ${os.platform()}.`);
  process.exit(0);
}

fail(`No usable Python runtime could run packaged ${target} engine health. Last error: ${lastError}`);
