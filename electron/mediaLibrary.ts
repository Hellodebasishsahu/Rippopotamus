import { net } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ffmpegPath, libraryThumbCacheDir } from "./appPaths";

export function decodeMediaPath(rippoUrl: string): string | null {
  try {
    const url = new URL(rippoUrl);
    if (url.protocol !== "rippo-media:") return null;
    const encoded = url.pathname.replace(/^\/+/, "");
    const decoded = decodeURIComponent(encoded);
    const resolved = path.resolve("/", decoded);
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

export function pathToRippoMediaUrl(absolute: string): string {
  const normalized = path.resolve(absolute);
  const encoded = normalized.split(path.sep).map(encodeURIComponent).join("/");
  return `rippo-media://local/${encoded.replace(/^\/+/, "")}`;
}

export async function fetchMediaFile(absolutePath: string): Promise<Response> {
  return await net.fetch(pathToFileURL(absolutePath).toString(), { bypassCustomProtocolHandlers: true });
}

export async function extractLibraryThumbnail(filePath: string, time: number): Promise<string | null> {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) return null;
  const safeTime = Number.isFinite(time) && time >= 0 ? time : 0;
  const cacheDir = libraryThumbCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const hash = createHash("sha1").update(`${resolved}|${safeTime.toFixed(2)}`).digest("hex").slice(0, 24);
  const out = path.join(cacheDir, `${hash}.jpg`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  return await new Promise<string | null>((resolve) => {
    const args = [
      "-y",
      "-ss", String(safeTime),
      "-i", resolved,
      "-frames:v", "1",
      "-vf", "scale='min(480,iw)':-2",
      "-q:v", "4",
      out,
    ];
    const child = spawn(ffmpeg, args, { stdio: "ignore" });
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 15000);
    child.on("error", () => { clearTimeout(killer); resolve(null); });
    child.on("exit", (code) => {
      clearTimeout(killer);
      if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) resolve(out);
      else resolve(null);
    });
  });
}
