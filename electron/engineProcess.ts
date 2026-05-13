import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  appManagedGalleryDlRoot,
  appManagedOpenRouterModelsCache,
  appManagedQbittorrentProfileRoot,
  appManagedYtDlpPath,
  bundledQbittorrentPath,
  ffmpegPath,
} from "./appPaths";
import { currentOpenRouterModel } from "./settingsStore";

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

function parseEnvFile(content: string): NodeJS.ProcessEnv {
  const parsed: NodeJS.ProcessEnv = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function engineCwd(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function localEnvFile(): NodeJS.ProcessEnv {
  const candidates = [
    path.join(engineCwd(), ".env"),
    path.join(app.getPath("userData"), ".env"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return parseEnvFile(fs.readFileSync(candidate, "utf8"));
    } catch {
      undefined;
    }
  }
  return {};
}

function engineEnv(): NodeJS.ProcessEnv {
  const resourcesEngine = path.join(process.resourcesPath, "engine");
  const devEngine = path.join(app.getAppPath(), "src");
  const pythonPath = app.isPackaged ? resourcesEngine : devEngine;
  const managedGalleryDlRoot = appManagedGalleryDlRoot();
  const bundledFfmpeg = ffmpegPath();
  const selectedOpenRouterModel = currentOpenRouterModel();
  const baseEnv = { ...localEnvFile(), ...process.env };
  fs.mkdirSync(path.dirname(appManagedYtDlpPath()), { recursive: true });
  return {
    ...baseEnv,
    PYTHONPATH: [fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : null, pythonPath, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter),
    RIPPO_FFMPEG_PATH: bundledFfmpeg || baseEnv.RIPPO_FFMPEG_PATH || "",
    RIPPO_YTDLP_PATH: baseEnv.RIPPO_YTDLP_PATH || appManagedYtDlpPath(),
    RIPPO_GALLERYDL_ROOT: fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : "",
    RIPPO_OPENROUTER_MODELS_CACHE: appManagedOpenRouterModelsCache(),
    OPENROUTER_MODEL: selectedOpenRouterModel,
    RIPPO_QBITTORRENT_PATH: baseEnv.RIPPO_QBITTORRENT_PATH || bundledQbittorrentPath() || "",
    RIPPO_QBITTORRENT_PROFILE_ROOT: baseEnv.RIPPO_QBITTORRENT_PROFILE_ROOT || appManagedQbittorrentProfileRoot(),
    RIPPO_QBITTORRENT_WEBUI_PORT: baseEnv.RIPPO_QBITTORRENT_WEBUI_PORT || "39080",
  };
}

export function runPython(args: string[], env: NodeJS.ProcessEnv = engineEnv()): Promise<void> {
  const pythons = candidatePythons();

  return new Promise((resolve, reject) => {
    let index = 0;

    const tryNext = () => {
      const python = pythons[index++];
      if (!python) {
        reject(new Error("No Python runtime found for the local engine."));
        return;
      }

      const child = spawn(python, args, {
        env,
        cwd: engineCwd(),
      });

      let stderr = "";
      child.stdout.on("data", () => undefined);
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", () => {
        tryNext();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        if (stderr.includes("No module named pip") && index < pythons.length) {
          tryNext();
          return;
        }

        reject(new Error(stderr.trim() || `Python exited with code ${code}`));
      });
    };

    tryNext();
  });
}

export function runEngine(args: string[], onJson?: (payload: unknown) => void, envOverride: NodeJS.ProcessEnv = {}): Promise<unknown> {
  const env = { ...engineEnv(), ...envOverride };
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
