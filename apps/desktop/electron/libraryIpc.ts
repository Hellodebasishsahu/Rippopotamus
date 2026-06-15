import { ipcMain, shell, nativeImage, app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
// ffmpeg-static has a default export of `string | null` (the binary path).
import ffmpegPath from "ffmpeg-static";
import { currentOutputRoot } from "./settingsStore";
import { runEngine } from "./engineProcess";
import { loadThumbnail } from "./thumbnails";
import { resolveWithinRoots, assertWithinRoots } from "./pathGuard";
import type { LibraryThumbnailResult } from "./types";

const THUMBNAIL_MAX_DIMENSION = 320;
const THUMBNAIL_CACHE_LIMIT = 500;
const FFMPEG_TIMEOUT_MS = 10_000;

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
  ".mov",
  ".avi",
  ".ts",
  ".m2ts",
]);
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".heic",
]);

type ThumbnailCacheEntry = { mtimeMs: number; dataUrl: string };

// Keyed by the resolved absolute path. Map preserves insertion order, so the
// first key is the oldest — we evict it when the cache exceeds the limit.
const thumbnailCache = new Map<string, ThumbnailCacheEntry>();

function cacheGet(key: string, mtimeMs: number): string | null {
  const entry = thumbnailCache.get(key);
  if (entry && entry.mtimeMs === mtimeMs) {
    // Refresh recency.
    thumbnailCache.delete(key);
    thumbnailCache.set(key, entry);
    return entry.dataUrl;
  }
  return null;
}

function cacheSet(key: string, mtimeMs: number, dataUrl: string): void {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, { mtimeMs, dataUrl });
  while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest === undefined) break;
    thumbnailCache.delete(oldest);
  }
}

function mediaKind(target: string): "video" | "image" | "other" {
  const ext = path.extname(target).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

async function nativeThumbnailDataUrl(safe: string): Promise<string | null> {
  try {
    const image = await nativeImage.createThumbnailFromPath(safe, {
      width: THUMBNAIL_MAX_DIMENSION,
      height: THUMBNAIL_MAX_DIMENSION,
    });
    if (!image || image.isEmpty()) return null;
    return image.toDataURL();
  } catch {
    return null;
  }
}

function ffmpegThumbnailDataUrl(safe: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpeg = ffmpegPath;
    if (!ffmpeg) {
      reject(new Error("ffmpeg is unavailable."));
      return;
    }

    const tmpFile = path.join(
      app.getPath("temp"),
      `rippo-thumb-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
    );

    const args = [
      "-ss",
      "1",
      "-i",
      safe,
      "-frames:v",
      "1",
      "-vf",
      `scale=${THUMBNAIL_MAX_DIMENSION}:-1`,
      "-y",
      tmpFile,
    ];

    const child = spawn(ffmpeg, args, { stdio: "ignore" });

    let settled = false;
    const cleanup = () => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // best effort
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      cleanup();
      reject(new Error("ffmpeg timed out."));
    }, FFMPEG_TIMEOUT_MS);
    timer.unref?.();

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        cleanup();
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      try {
        const bytes = fs.readFileSync(tmpFile);
        cleanup();
        if (!bytes.length) {
          reject(new Error("ffmpeg produced an empty frame."));
          return;
        }
        resolve(`data:image/png;base64,${bytes.toString("base64")}`);
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

async function generateThumbnail(safe: string): Promise<LibraryThumbnailResult> {
  const kind = mediaKind(safe);

  // First try Electron's native thumbnailer. Works for images and, on macOS,
  // often for documents and even some videos.
  const native = await nativeThumbnailDataUrl(safe);
  if (native) return { ok: true, dataUrl: native };

  // Fall back to ffmpeg for video files.
  if (kind === "video") {
    try {
      const dataUrl = await ffmpegThumbnailDataUrl(safe);
      return { ok: true, dataUrl };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { ok: false, error: "No thumbnail available." };
}

export function registerLibraryIpcHandlers() {
  ipcMain.handle("thumbnail:load", async (_event, urls: unknown) => {
    return loadThumbnail(urls);
  });

  ipcMain.handle("library:list", async (_event, payload?: { outputRoot?: string }) => {
    const root = currentOutputRoot();
    let outputRoot = root;
    const requested = typeof payload?.outputRoot === "string" ? payload.outputRoot.trim() : "";
    if (requested) {
      const validated = resolveWithinRoots(requested, [root]);
      outputRoot = validated ?? root;
    }
    return runEngine(["library-list", "--output-root", outputRoot]);
  });

  ipcMain.handle("shell:open-path", async (_event, target: string) => {
    const root = currentOutputRoot();
    const resolved = assertWithinRoots(target, [root]);
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  });

  ipcMain.handle("shell:show-item", async (_event, target: string) => {
    const root = currentOutputRoot();
    const resolved = assertWithinRoots(target, [root]);
    shell.showItemInFolder(resolved);
  });

  ipcMain.handle(
    "library:thumbnail",
    async (_event, target: string): Promise<LibraryThumbnailResult> => {
      const safe = resolveWithinRoots(target, [currentOutputRoot()]);
      if (safe === null) {
        return { ok: false, error: "Outside library." };
      }

      let mtimeMs: number;
      try {
        mtimeMs = fs.statSync(safe).mtimeMs;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      const cached = cacheGet(safe, mtimeMs);
      if (cached !== null) {
        return { ok: true, dataUrl: cached };
      }

      const result = await generateThumbnail(safe);
      if (result.ok && result.dataUrl) {
        cacheSet(safe, mtimeMs, result.dataUrl);
      }
      return result;
    },
  );
}
