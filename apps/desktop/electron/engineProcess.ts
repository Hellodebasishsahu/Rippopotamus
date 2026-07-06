import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  appManagedGalleryDlRoot,
  appManagedYtDlpPath,
  bundledAria2cPath,
  ffmpegPath,
} from "./appPaths";
import { logEngineEnd, logEngineStart } from "./engineLog";

let engineInvocationSeq = 0;
function nextEngineLogId(): string {
  engineInvocationSeq += 1;
  return `e${engineInvocationSeq}`;
}

function bundledEngineExecutable(): string | null {
  const name = process.platform === "win32" ? "rippo-engine.exe" : "rippo-engine";
  const candidates = [
    process.env.RIPPO_ENGINE_BINARY?.trim(),
    path.join(process.resourcesPath, "bin", name),
    path.join(app.getAppPath(), "bin", name),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      undefined;
    }
  }
  return null;
}

function candidatePythons(): string[] {
  const configured = process.env.RIPPO_PYTHON;
  const platformCandidates = process.platform === "win32"
    ? ["py", "python", "python3"]
    : [
        "/opt/homebrew/opt/python@3.13/libexec/bin/python",
        "/opt/homebrew/bin/python3",
        "python3",
        "python",
      ];
  return [configured, ...platformCandidates].filter(Boolean) as string[];
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

function repoRoot(): string {
  return app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), "../..");
}

function engineCwd(): string {
  return app.isPackaged ? process.resourcesPath : repoRoot();
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
  const devEngine = path.join(repoRoot(), "src");
  const pythonPath = app.isPackaged ? resourcesEngine : devEngine;
  const managedGalleryDlRoot = appManagedGalleryDlRoot();
  const bundledFfmpeg = ffmpegPath();
  const baseEnv = { ...localEnvFile(), ...process.env };
  fs.mkdirSync(path.dirname(appManagedYtDlpPath()), { recursive: true });
  return {
    ...baseEnv,
    PYTHONPATH: [fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : null, pythonPath, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter),
    RIPPO_FFMPEG_PATH: bundledFfmpeg || baseEnv.RIPPO_FFMPEG_PATH || "",
    RIPPO_YTDLP_PATH: baseEnv.RIPPO_YTDLP_PATH || appManagedYtDlpPath(),
    RIPPO_GALLERYDL_ROOT: fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : "",
    RIPPO_ARIA2C_PATH: baseEnv.RIPPO_ARIA2C_PATH || bundledAria2cPath() || "",
  };
}

function errorMessageFromJson(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const ok = typeof record.ok === "boolean" ? record.ok : undefined;
  if (type !== "error" && ok !== false) return null;
  for (const key of ["error", "message", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
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

function runBundledEngine(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onJson?: (payload: unknown) => void,
  registerCancel?: (cancel: () => void) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const logId = nextEngineLogId();
    const startedAt = Date.now();
    logEngineStart(logId, path.basename(executable), args);
    const child = spawn(executable, args, { env, cwd: engineCwd() });

    let stdout = "";
    let stderr = "";
    let lastJson: unknown = null;
    let canceled = false;
    let closed = false;

    registerCancel?.(() => {
      if (canceled || closed) return;
      canceled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, 3000).unref();
    });

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

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      closed = true;
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

      logEngineEnd(logId, code, Date.now() - startedAt, stderr);

      if (canceled) {
        reject(new Error("Download canceled."));
        return;
      }

      if (code === 0) {
        resolve(lastJson);
        return;
      }

      reject(new Error(errorMessageFromJson(lastJson) || stderr.trim() || `Engine exited with code ${code}`));
    });
  });
}

export function runEngine(args: string[], onJson?: (payload: unknown) => void, envOverride: NodeJS.ProcessEnv = {}, registerCancel?: (cancel: () => void) => void): Promise<unknown> {
  const env = { ...engineEnv(), ...envOverride };
  const bundled = bundledEngineExecutable();
  if (bundled && (app.isPackaged || process.env.RIPPO_ENGINE_BINARY)) {
    return runBundledEngine(bundled, args, env, onJson, registerCancel);
  }
  const pythons = candidatePythons();

  return new Promise((resolve, reject) => {
    let index = 0;

    const tryNext = () => {
      const python = pythons[index++];
      if (!python) {
        reject(new Error("No Python runtime found for the local engine."));
        return;
      }

      const logId = nextEngineLogId();
      const startedAt = Date.now();
      logEngineStart(logId, `python -m rippopotamus.desktop_engine`, args);
      const child = spawn(python, ["-m", "rippopotamus.desktop_engine", ...args], {
        env,
        cwd: engineCwd(),
      });

      let stdout = "";
      let stderr = "";
      let lastJson: unknown = null;
      let canceled = false;
      let closed = false;

      registerCancel?.(() => {
        if (canceled || closed) return;
        canceled = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!closed) child.kill("SIGKILL");
        }, 3000).unref();
      });

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
        if (canceled) {
          reject(new Error("Download canceled."));
          return;
        }
        tryNext();
      });

      child.on("close", (code) => {
        closed = true;
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

        logEngineEnd(logId, code, Date.now() - startedAt, stderr);

        if (canceled) {
          reject(new Error("Download canceled."));
          return;
        }

        if (code === 0) {
          resolve(lastJson);
          return;
        }

        if (stderr.includes("No module named rippopotamus") && index < pythons.length) {
          tryNext();
          return;
        }

        reject(new Error(errorMessageFromJson(lastJson) || stderr.trim() || `Engine exited with code ${code}`));
      });
    };

    tryNext();
  });
}
