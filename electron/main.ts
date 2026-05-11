import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  cookieSourceBrowserId,
  cookieSourceFromBrowserId,
  validateCookieSource,
  validateCookiesBrowserId,
  type BrowserInfo,
  type CookieSource,
} from "./cookies";
import { loadThumbnail } from "./thumbnails";

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

function appManagedYtDlpPath(): string {
  return path.join(app.getPath("userData"), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

function appManagedGalleryDlRoot(): string {
  return path.join(app.getPath("userData"), "python", "gallery-dl");
}

function appManagedQbittorrentProfileRoot(): string {
  return path.join(app.getPath("userData"), "qbittorrent");
}

function bundledQbittorrentPath(): string | null {
  const executable = process.platform === "win32" ? "qbittorrent-nox.exe" : "qbittorrent-nox";
  const candidates = [
    path.join(process.resourcesPath, "bin", executable),
    path.join(app.getAppPath(), "bin", executable),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

type Settings = {
  cookieSource?: CookieSource;
  cookiesBrowser?: string;
  outputRoot?: string;
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

function writeSettings(next: Settings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}

type YtDlpReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type YtDlpRelease = {
  tag_name: string;
  assets: YtDlpReleaseAsset[];
};

type YtDlpUpdateInfo = {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  binaryPath: string;
  managedBinaryExists: boolean;
  downloadUrl?: string;
  error?: string;
};

type PyPiPackageInfo = {
  info: {
    version: string;
  };
};

function detectBrowsers(): BrowserInfo[] {
  if (process.platform !== "darwin") return [];
  const candidates: { id: string; label: string; bundles: string[] }[] = [
    { id: "safari", label: "Safari", bundles: ["Safari.app"] },
    { id: "chrome", label: "Chrome", bundles: ["Google Chrome.app", "Google Chrome Canary.app"] },
    { id: "firefox", label: "Firefox", bundles: ["Firefox.app", "Firefox Developer Edition.app"] },
    { id: "brave", label: "Brave", bundles: ["Brave Browser.app"] },
    { id: "edge", label: "Edge", bundles: ["Microsoft Edge.app"] },
    { id: "vivaldi", label: "Vivaldi", bundles: ["Vivaldi.app"] },
    { id: "opera", label: "Opera", bundles: ["Opera.app"] },
    { id: "chromium", label: "Chromium", bundles: ["Chromium.app"] },
  ];
  const roots = ["/Applications", path.join(app.getPath("home"), "Applications")];
  const found: BrowserInfo[] = [];
  for (const c of candidates) {
    for (const bundle of c.bundles) {
      for (const root of roots) {
        const p = path.join(root, bundle);
        if (fs.existsSync(p)) {
          found.push({ id: c.id, label: c.label, appPath: p });
          break;
        }
      }
      if (found.find((b) => b.id === c.id)) break;
    }
  }
  return found;
}

function cookiesSupported(): boolean {
  return process.platform === "darwin";
}

function defaultCookieSource(browsers: BrowserInfo[] = detectBrowsers()): CookieSource {
  const settings = readSettings();
  try {
    if (settings.cookieSource) return validateCookieSource(settings.cookieSource, browsers);
    if (settings.cookiesBrowser) return cookieSourceFromBrowserId(settings.cookiesBrowser, browsers);
  } catch {
    return { mode: "off" };
  }
  return { mode: "off" };
}

function cookieSourceArgs(source: CookieSource): string[] {
  if (source.mode !== "browser") return [];
  return ["--cookies-browser", source.browserId];
}

function cookiesResponse(browsers: BrowserInfo[] = detectBrowsers()) {
  const source = defaultCookieSource(browsers);
  return {
    browsers,
    selected: cookieSourceBrowserId(source),
    source,
    supported: cookiesSupported(),
  };
}

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^v/i, "") || null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left)?.split(/[.-]/).map((part) => Number(part)) || [];
  const rightParts = normalizeVersion(right)?.split(/[.-]/).map((part) => Number(part)) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const b = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function ytDlpAssetName(): string {
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "linux" && process.arch === "arm64") return "yt-dlp_linux_aarch64";
  return "yt-dlp_linux";
}

async function fetchLatestYtDlpRelease(): Promise<YtDlpRelease> {
  const response = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`GitHub release check failed: ${response.status}`);
  return await response.json() as YtDlpRelease;
}

function selectYtDlpAsset(release: YtDlpRelease): YtDlpReleaseAsset {
  const expected = ytDlpAssetName();
  const asset = release.assets.find((candidate) => candidate.name === expected);
  if (!asset) throw new Error(`No yt-dlp release asset found for ${process.platform}/${process.arch}.`);
  return asset;
}

async function currentYtDlpVersion(): Promise<string | null> {
  try {
    const health = await runEngine(["health"]) as { ytDlp?: string };
    return normalizeVersion(health.ytDlp);
  } catch {
    return null;
  }
}

async function checkYtDlpUpdate(): Promise<YtDlpUpdateInfo> {
  const binaryPath = appManagedYtDlpPath();
  const [release, currentVersion] = await Promise.all([
    fetchLatestYtDlpRelease(),
    currentYtDlpVersion(),
  ]);
  const latestVersion = normalizeVersion(release.tag_name);
  const asset = selectYtDlpAsset(release);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion && (!currentVersion || compareVersions(latestVersion, currentVersion) > 0)),
    binaryPath,
    managedBinaryExists: fs.existsSync(binaryPath),
    downloadUrl: asset.browser_download_url,
  };
}

async function fetchLatestGalleryDlPackage(): Promise<PyPiPackageInfo> {
  const response = await fetch("https://pypi.org/pypi/gallery-dl/json", {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`gallery-dl release check failed: ${response.status}`);
  return await response.json() as PyPiPackageInfo;
}

async function currentGalleryDlVersion(): Promise<string | null> {
  try {
    const health = await runEngine(["health"]) as { galleryDl?: string | null };
    return normalizeVersion(health.galleryDl);
  } catch {
    return null;
  }
}

async function checkGalleryDlUpdate(): Promise<YtDlpUpdateInfo> {
  const binaryPath = appManagedGalleryDlRoot();
  const [latest, currentVersion] = await Promise.all([
    fetchLatestGalleryDlPackage(),
    currentGalleryDlVersion(),
  ]);
  const latestVersion = normalizeVersion(latest.info.version);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion && (!currentVersion || compareVersions(latestVersion, currentVersion) > 0)),
    binaryPath,
    managedBinaryExists: fs.existsSync(binaryPath),
    downloadUrl: latestVersion ? `gallery-dl==${latestVersion}` : undefined,
  };
}

async function installYtDlpUpdate(downloadUrl: string): Promise<void> {
  const binaryPath = appManagedYtDlpPath();
  const binDir = path.dirname(binaryPath);
  const tmpPath = path.join(binDir, `${path.basename(binaryPath)}.${process.pid}.tmp`);
  fs.mkdirSync(binDir, { recursive: true });

  const response = await fetch(downloadUrl, {
    headers: {
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`yt-dlp download failed: ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tmpPath, bytes, { mode: 0o755 });
  if (process.platform !== "win32") fs.chmodSync(tmpPath, 0o755);
  fs.renameSync(tmpPath, binaryPath);
}

function runPython(args: string[], env: NodeJS.ProcessEnv = engineEnv()): Promise<void> {
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

async function installGalleryDlUpdate(version: string): Promise<void> {
  const target = appManagedGalleryDlRoot();
  const tmpTarget = path.join(path.dirname(target), `gallery-dl.${process.pid}.tmp`);
  fs.rmSync(tmpTarget, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });

  await runPython([
    "-m",
    "pip",
    "install",
    "--upgrade",
    "--no-input",
    "--disable-pip-version-check",
    "--target",
    tmpTarget,
    `gallery-dl==${version}`,
  ]);

  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmpTarget, target);
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
  const managedGalleryDlRoot = appManagedGalleryDlRoot();
  const bundledFfmpeg = ffmpegPath();
  fs.mkdirSync(path.dirname(appManagedYtDlpPath()), { recursive: true });
  return {
    ...process.env,
    PYTHONPATH: [fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : null, pythonPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    RIPPO_FFMPEG_PATH: bundledFfmpeg || process.env.RIPPO_FFMPEG_PATH || "",
    RIPPO_YTDLP_PATH: process.env.RIPPO_YTDLP_PATH || appManagedYtDlpPath(),
    RIPPO_GALLERYDL_ROOT: fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : "",
    RIPPO_QBITTORRENT_PATH: process.env.RIPPO_QBITTORRENT_PATH || bundledQbittorrentPath() || "",
    RIPPO_QBITTORRENT_PROFILE_ROOT: process.env.RIPPO_QBITTORRENT_PROFILE_ROOT || appManagedQbittorrentProfileRoot(),
    RIPPO_QBITTORRENT_WEBUI_PORT: process.env.RIPPO_QBITTORRENT_WEBUI_PORT || "39080",
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
  return path.join(app.getPath("downloads"), "Rippo");
}

function currentOutputRoot(): string {
  const saved = readSettings().outputRoot;
  if (saved && typeof saved === "string" && saved.trim()) return saved;
  return defaultOutputRoot();
}

async function engineHealthPayload(): Promise<Record<string, unknown>> {
  const browsers = detectBrowsers();
  const source = defaultCookieSource(browsers);
  return {
    ...((await runEngine(["health", ...cookieSourceArgs(source)])) as Record<string, unknown>),
    cookiesSupported: cookiesSupported(),
    cookiesBrowsers: browsers,
    cookiesBrowser: cookieSourceBrowserId(source),
    cookieSource: source,
    outputRoot: currentOutputRoot(),
    packaged: app.isPackaged,
  };
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
  ipcMain.handle("engine:health", async () => engineHealthPayload());

  ipcMain.handle("engine:fetch", async (_event, url: string, provider?: string, cookieSourceInput?: unknown) => {
    const cookieSource = validateCookieSource(cookieSourceInput, detectBrowsers());
    const args = ["fetch", "--url", url];
    if (provider) args.push("--provider", provider);
    args.push(...cookieSourceArgs(cookieSource));
    try {
      return await runEngine(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        url,
        error: message || "Fetch failed.",
      };
    }
  });

  ipcMain.handle("engine:download", async (event, payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string; cookieSource?: unknown }) => {
    const cookieSource = validateCookieSource(payload.cookieSource, detectBrowsers());
    const jobId = payload.itemId || randomUUID();
    const outputRoot = payload.outputRoot || currentOutputRoot();
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
      ...cookieSourceArgs(cookieSource),
    ];
    const result = await runEngine(args, (engineEvent) => {
      event.sender.send("engine:download-event", { jobId, ...engineEvent as Record<string, unknown> });
    });
    return { jobId, result };
  });

  ipcMain.handle("shell:open-folder", async (_event, folder: string) => {
    const target = folder || currentOutputRoot();
    fs.mkdirSync(target, { recursive: true });
    await shell.openPath(target);
  });

  ipcMain.handle("output:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined as unknown as BrowserWindow, {
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

  ipcMain.handle("cookies:list-browsers", async () => {
    return cookiesResponse();
  });

  ipcMain.handle("cookies:set-default-source", async (_event, sourceInput: unknown) => {
    const browsers = detectBrowsers();
    const source = validateCookieSource(sourceInput, browsers);
    const settings = readSettings();
    settings.cookieSource = source;
    delete settings.cookiesBrowser;
    writeSettings(settings);
    return cookiesResponse(browsers);
  });

  ipcMain.handle("cookies:set-browser", async (_event, browserId: string | null) => {
    const browsers = detectBrowsers();
    const selected = validateCookiesBrowserId(browserId, browsers);
    const settings = readSettings();
    settings.cookieSource = selected ? { mode: "browser", browserId: selected } : { mode: "off" };
    delete settings.cookiesBrowser;
    writeSettings(settings);
    return cookiesResponse(browsers);
  });

  ipcMain.handle("thumbnail:load", async (_event, urls: unknown) => {
    return loadThumbnail(urls);
  });

  ipcMain.handle("ytdlp:check-update", async () => {
    return checkYtDlpUpdate();
  });

  ipcMain.handle("ytdlp:update", async () => {
    const update = await checkYtDlpUpdate();
    if (!update.downloadUrl) throw new Error("No yt-dlp download URL is available.");
    await installYtDlpUpdate(update.downloadUrl);
    const health = await engineHealthPayload();
    return {
      ...(await checkYtDlpUpdate()),
      health,
    };
  });

  ipcMain.handle("gallerydl:check-update", async () => {
    return checkGalleryDlUpdate();
  });

  ipcMain.handle("gallerydl:update", async () => {
    const update = await checkGalleryDlUpdate();
    if (!update.latestVersion) throw new Error("No gallery-dl version is available.");
    await installGalleryDlUpdate(update.latestVersion);
    const health = await engineHealthPayload();
    return {
      ...(await checkGalleryDlUpdate()),
      health,
    };
  });

  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http and https URLs can be opened.");
    }
    await shell.openExternal(parsed.toString());
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
