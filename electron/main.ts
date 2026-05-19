import { app, BrowserWindow, protocol } from "electron";
import path from "node:path";
import { registerIndexIpcHandlers } from "./indexIpc";
import { registerCookieIpcHandlers } from "./cookiesIpc";
import { registerToolUpdateIpcHandlers } from "./toolUpdatesIpc";
import { registerAppUpdateIpcHandlers } from "./appUpdatesIpc";
import { registerShellOutputIpcHandlers } from "./shellOutputIpc";
import { handleRippoMediaRequest, registerLibraryIpcHandlers } from "./libraryIpc";
import { createEngineIpc } from "./engineIpc";
import { browserSerpEnabled, registerBrowserIpcHandlers } from "./browserIpc";
import { initAdBlocker } from "./adBlocker";

let mainWindow: BrowserWindow | null = null;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rippo-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

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
  const engineIpc = createEngineIpc({ browserSerpEnabled });
  protocol.handle("rippo-media", handleRippoMediaRequest);
  registerLibraryIpcHandlers();
  registerBrowserIpcHandlers();
  engineIpc.registerEngineIpcHandlers();
  registerIndexIpcHandlers();

  registerShellOutputIpcHandlers(() => mainWindow);
  registerCookieIpcHandlers();

  registerToolUpdateIpcHandlers(engineIpc.engineHealthPayload);
  registerAppUpdateIpcHandlers();

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
