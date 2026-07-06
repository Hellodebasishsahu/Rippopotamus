import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerCookieIpcHandlers } from "./cookiesIpc";
import { registerHelperIpcHandlers } from "./helperRegistry";
import { registerAppUpdateIpcHandlers } from "./appUpdatesIpc";
import { registerShellOutputIpcHandlers } from "./shellOutputIpc";
import { registerLibraryIpcHandlers } from "./libraryIpc";
import { createEngineIpc } from "./engineIpc";
import { registerBrowserIpcHandlers } from "./browserIpc";
import { initAdBlocker } from "./adBlocker";

let mainWindow: BrowserWindow | null = null;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    title: "Rippopotamus",
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  initAdBlocker();
  const engineIpc = createEngineIpc();
  registerLibraryIpcHandlers();
  registerBrowserIpcHandlers();
  engineIpc.registerEngineIpcHandlers();

  registerShellOutputIpcHandlers(() => mainWindow);
  registerCookieIpcHandlers();

  registerHelperIpcHandlers(engineIpc.engineHealthPayload);
  registerAppUpdateIpcHandlers();

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
