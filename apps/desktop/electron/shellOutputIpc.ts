import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import { currentOutputRoot, defaultOutputRoot, readSettings, writeSettings } from "./settingsStore";

export function registerShellOutputIpcHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle("shell:open-folder", async (_event, folder: string) => {
    const target = folder || currentOutputRoot();
    fs.mkdirSync(target, { recursive: true });
    await shell.openPath(target);
  });

  ipcMain.handle("output:choose", async () => {
    const result = await dialog.showOpenDialog(getMainWindow() ?? undefined as unknown as BrowserWindow, {
      title: "Choose download location",
      defaultPath: currentOutputRoot(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { outputRoot: currentOutputRoot(), canceled: true };
    }
    const next = result.filePaths[0];
    const settings = readSettings();
    settings.outputRoot = next;
    writeSettings(settings);
    return { outputRoot: next, canceled: false };
  });

  ipcMain.handle("output:reset", async () => {
    const settings = readSettings();
    delete settings.outputRoot;
    writeSettings(settings);
    return { outputRoot: defaultOutputRoot() };
  });

  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http and https URLs can be opened.");
    }
    await shell.openExternal(parsed.toString());
  });
}
