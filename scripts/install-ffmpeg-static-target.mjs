import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [platform, arch] = process.argv.slice(2);

if (!platform || !arch) {
  console.error("Usage: node scripts/install-ffmpeg-static-target.mjs <platform> <arch>");
  process.exit(1);
}

const ffmpegDir = path.join(process.cwd(), "node_modules", "ffmpeg-static");
const installScript = path.join(ffmpegDir, "install.js");
const executable = path.join(ffmpegDir, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

if (!fs.existsSync(installScript)) {
  console.error("Missing node_modules/ffmpeg-static/install.js. Run npm ci first.");
  process.exit(1);
}

if (fs.existsSync(executable)) {
  console.log(`ffmpeg-static ${platform}/${arch} binary already exists: ${executable}`);
  process.exit(0);
}

const result = spawnSync(process.execPath, [installScript], {
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_platform: platform,
    npm_config_arch: arch,
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(executable)) {
  console.error(`ffmpeg-static install completed but did not create ${executable}`);
  process.exit(1);
}
