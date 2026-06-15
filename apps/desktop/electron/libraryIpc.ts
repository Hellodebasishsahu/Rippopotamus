import { ipcMain } from "electron";
import { loadThumbnail } from "./thumbnails";

export function registerLibraryIpcHandlers() {
  ipcMain.handle("thumbnail:load", async (_event, urls: unknown) => {
    return loadThumbnail(urls);
  });
}
