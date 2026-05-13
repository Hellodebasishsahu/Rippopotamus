import { ipcMain } from "electron";
import fs from "node:fs";
import { decodeMediaPath, extractLibraryThumbnail, fetchMediaFile, pathToRippoMediaUrl } from "./mediaLibrary";
import { loadThumbnail } from "./thumbnails";

export function registerLibraryIpcHandlers() {
  ipcMain.handle("library:thumbnail", async (_event, payload?: { path?: string; time?: number }) => {
    const filePath = typeof payload?.path === "string" ? payload.path : "";
    const time = typeof payload?.time === "number" ? payload.time : 0;
    const thumb = await extractLibraryThumbnail(filePath, time);
    if (!thumb) return { ok: false, url: null };
    return { ok: true, url: pathToRippoMediaUrl(thumb) };
  });

  ipcMain.handle("library:media-url", async (_event, payload?: { path?: string }) => {
    const filePath = typeof payload?.path === "string" ? payload.path : "";
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { ok: false, url: null };
    }
    return { ok: true, url: pathToRippoMediaUrl(filePath) };
  });

  ipcMain.handle("thumbnail:load", async (_event, urls: unknown) => {
    return loadThumbnail(urls);
  });
}

export async function handleRippoMediaRequest(request: Request): Promise<Response> {
  const resolved = decodeMediaPath(request.url);
  if (!resolved) return new Response("Not Found", { status: 404 });
  try {
    return await fetchMediaFile(resolved);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
