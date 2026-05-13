import { app } from "electron";
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
    return require("ffmpeg-static") || null;
  } catch {
    return null;
  }
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
