import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

let mainWindow: BrowserWindow | null = null;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function ffmpegPath(): string | null {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg");
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

function candidatePythons(): string[] {
  const configured = process.env.RIPPO_PYTHON;
  return [
    configured,
    "/opt/homebrew/opt/python@3.13/libexec/bin/python",
    "/opt/homebrew/bin/python3",
    "python3",
    "python",
  ].filter(Boolean) as string[];
}

function engineEnv(): NodeJS.ProcessEnv {
  const resourcesEngine = path.join(process.resourcesPath, "engine");
  const devEngine = path.join(app.getAppPath(), "src");
  const pythonPath = app.isPackaged ? resourcesEngine : devEngine;
  const bundledFfmpeg = ffmpegPath();
  return {
    ...process.env,
    PYTHONPATH: [pythonPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    RIPPO_FFMPEG_PATH: bundledFfmpeg || process.env.RIPPO_FFMPEG_PATH || "",
  };
}

function engineCwd(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function runEngine(args: string[], onJson?: (payload: unknown) => void): Promise<unknown> {
  const env = engineEnv();
  const pythons = candidatePythons();

  return new Promise((resolve, reject) => {
    let index = 0;

    const tryNext = () => {
      const python = pythons[index++];
      if (!python) {
        reject(new Error("No Python runtime found for the local engine."));
        return;
      }

      const child = spawn(python, ["-m", "rippopotamus.desktop_engine", ...args], {
        env,
        cwd: engineCwd(),
      });

      let stdout = "";
      let stderr = "";
      let lastJson: unknown = null;

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const payload = JSON.parse(line);
            lastJson = payload;
            onJson?.(payload);
          } catch {
            stderr += `${line}\n`;
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", () => {
        tryNext();
      });

      child.on("close", (code) => {
        if (stdout.trim()) {
          for (const line of stdout.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const payload = JSON.parse(line);
              lastJson = payload;
              onJson?.(payload);
            } catch {
              stderr += `${line}\n`;
            }
          }
        }

        if (code === 0) {
          resolve(lastJson);
          return;
        }

        if (stderr.includes("No module named rippopotamus") && index < pythons.length) {
          tryNext();
          return;
        }

        reject(new Error(stderr.trim() || `Engine exited with code ${code}`));
      });
    };

    tryNext();
  });
}

function defaultOutputRoot(): string {
  return path.join(app.getPath("videos"), "Rippopotamus Downloads");
}

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
  ipcMain.handle("engine:health", async () => ({
    ...((await runEngine(["health"])) as Record<string, unknown>),
    outputRoot: defaultOutputRoot(),
    packaged: app.isPackaged,
  }));

  ipcMain.handle("engine:fetch", async (_event, url: string) => {
    return runEngine(["fetch", "--url", url]);
  });

  ipcMain.handle("engine:download", async (event, payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string }) => {
    const jobId = payload.itemId || randomUUID();
    const outputRoot = payload.outputRoot || defaultOutputRoot();
    fs.mkdirSync(outputRoot, { recursive: true });
    const args = [
      "download",
      "--url",
      payload.url,
      "--preset",
      payload.preset,
      "--output-root",
      outputRoot,
      "--item-id",
      payload.itemId || jobId.slice(0, 10),
      "--title",
      payload.title || "",
    ];
    const result = await runEngine(args, (engineEvent) => {
      event.sender.send("engine:download-event", { jobId, ...engineEvent as Record<string, unknown> });
    });
    return { jobId, result };
  });

  ipcMain.handle("shell:open-folder", async (_event, folder: string) => {
    await shell.openPath(folder || defaultOutputRoot());
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
