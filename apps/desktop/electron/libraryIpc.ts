import { ipcMain, shell } from "electron";
import path from "node:path";
import { currentOutputRoot } from "./settingsStore";
import { runEngine } from "./engineProcess";
import { loadThumbnail } from "./thumbnails";

export function registerLibraryIpcHandlers() {
  ipcMain.handle("thumbnail:load", async (_event, urls: unknown) => {
    return loadThumbnail(urls);
  });

  ipcMain.handle("library:list", async (_event, payload?: { outputRoot?: string; query?: string }) => {
    const outputRoot = typeof payload?.outputRoot === "string" && payload.outputRoot.trim()
      ? payload.outputRoot.trim()
      : currentOutputRoot();
    const query = typeof payload?.query === "string" ? payload.query : "";
    const args = ["library-list", "--output-root", outputRoot];
    if (query.trim()) args.push("--query", query.trim());
    return runEngine(args);
  });

  ipcMain.handle("shell:open-path", async (_event, target: string) => {
    const resolved = path.resolve(target);
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  });

  ipcMain.handle("shell:show-item", async (_event, target: string) => {
    shell.showItemInFolder(path.resolve(target));
  });
}
