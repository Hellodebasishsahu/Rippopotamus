import { app } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function ffmpegPath(): string | null {
  const executable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "ffmpeg-static", executable);
    if (fs.existsSync(unpacked)) return unpacked;
  }

  try {
    // ffmpeg-static resolves to the bundled platform binary in dev and packaged builds.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bundled = require("ffmpeg-static") || null;
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // Fall through to PATH lookup.
  }

  const result = spawnSync(executable, ["-version"], { encoding: "utf8" });
  return result.status === 0 ? executable : null;
}

export function appManagedYtDlpPath(): string {
  return path.join(app.getPath("userData"), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

export function appManagedGalleryDlRoot(): string {
  return path.join(app.getPath("userData"), "python", "gallery-dl");
}

export function appManagedOpenRouterModelsCache(): string {
  return path.join(app.getPath("userData"), "cache", "openrouter-free-models.json");
}

export function appManagedQbittorrentProfileRoot(): string {
  return path.join(app.getPath("userData"), "qbittorrent");
}

export function bundledQbittorrentPath(): string | null {
  const executable = process.platform === "win32" ? "qbittorrent-nox.exe" : "qbittorrent-nox";
  const candidates = [
    path.join(process.resourcesPath, "bin", executable),
    path.join(app.getAppPath(), "bin", executable),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function libraryThumbCacheDir(): string {
  return path.join(app.getPath("userData"), "library-thumbs");
}

export function libraryIndexRoot(): string {
  return path.join(app.getPath("userData"), "library-index");
}
