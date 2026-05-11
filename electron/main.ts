import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
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
import {
  addProbeCandidate,
  firstHeaderValue,
  isAllowedProbePageUrl,
  sortedProbeCandidates,
  validateProbeUrl,
  type PageProbeCandidate,
  type PendingProbeCandidate,
} from "./pageProbePolicy";
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

function appManagedOpenRouterModelsCache(): string {
  return path.join(app.getPath("userData"), "cache", "openrouter-free-models.json");
}

type Settings = {
  cookieSource?: CookieSource;
  cookiesBrowser?: string;
  outputRoot?: string;
  openRouterModel?: string;
};

type PageProbeResponse = {
  ok: true;
  url: string;
  finalUrl: string;
  candidates: PageProbeCandidate[];
  timedOut: boolean;
} | {
  ok: false;
  url: string;
  error: string;
  candidates: PageProbeCandidate[];
  timedOut?: boolean;
};

type SearchEvidenceResult = {
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  position?: number;
};

type SearchEvidencePayload = {
  enabled: boolean;
  source: string;
  provider: string;
  label: string;
  query: string;
  requestedPack: string;
  results: SearchEvidenceResult[];
  resultCount: number;
  reason: string;
  error?: string;
};

type DomProbeCandidate = {
  url: string;
  label?: string;
  contentType?: string;
};

type ProbeBeforeRequestListener = (
  details: Electron.OnBeforeRequestListenerDetails,
  callback: (response: Electron.CallbackResponse) => void,
) => void;

type ProbeHeadersReceivedListener = (
  details: Electron.OnHeadersReceivedListenerDetails,
  callback: (response: Electron.HeadersReceivedResponse) => void,
) => void;

const PAGE_PROBE_TIMEOUT_MS = 18_000;
const SERP_SCOUT_TIMEOUT_MS = 18_000;
const PAGE_PROBE_MAX_TRACKED_REQUESTS = 1_000;
let activePageProbe: Promise<PageProbeResponse> | null = null;
let activeSourceSearch: Promise<unknown> | null = null;
let activeSourceSearchKey = "";

function browserSerpEnabled(): boolean {
  const provider = (process.env.RIPPO_SEARCH_PROVIDER || "").trim().toLowerCase();
  if (provider === "electron_google") return true;
  if (provider && provider !== "electron_google") return false;
  return ["1", "true", "yes", "on"].includes((process.env.RIPPO_SERP_BROWSER || "").trim().toLowerCase());
}

async function probePage(inputUrl: unknown, timeoutMs = PAGE_PROBE_TIMEOUT_MS): Promise<PageProbeResponse> {
  let targetUrl = "";
  const candidates = new Map<string, PendingProbeCandidate>();
  let win: BrowserWindow | null = null;
  let timedOut = false;
  const partition = `rippo-page-probe:${randomUUID()}`;
  const probeSession = session.fromPartition(partition, { cache: false });
  const requestMethods = new Map<string, string>();
  const filter = { urls: ["http://*/*", "https://*/*"] };

  try {
    targetUrl = validateProbeUrl(inputUrl);

    const onBeforeRequest: ProbeBeforeRequestListener = (details, callback) => {
      if (!isAllowedProbePageUrl(details.url)) {
        callback({ cancel: true });
        return;
      }
      if (requestMethods.size < PAGE_PROBE_MAX_TRACKED_REQUESTS) {
        requestMethods.set(details.url, details.method || "GET");
      }
      addProbeCandidate(candidates, details.url, "network", details.method || "GET");
      callback({});
    };
    const onHeadersReceived: ProbeHeadersReceivedListener = (details, callback) => {
      const contentType = firstHeaderValue(details.responseHeaders, "content-type");
      addProbeCandidate(candidates, details.url, "network", requestMethods.get(details.url) || details.method || "GET", contentType);
      requestMethods.delete(details.url);
      callback({ responseHeaders: details.responseHeaders });
    };

    probeSession.webRequest.onBeforeRequest(filter, onBeforeRequest);
    probeSession.webRequest.onHeadersReceived(filter, onHeadersReceived);
    probeSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    probeSession.setPermissionCheckHandler(() => false);

    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        images: true,
        javascript: true,
      },
    });

    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, navigationUrl) => {
      if (!isAllowedProbePageUrl(navigationUrl)) event.preventDefault();
    });

    const waitForPage = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);

      const finish = () => {
        clearTimeout(timeout);
        resolve();
      };

      win?.webContents.once("did-finish-load", finish);
      win?.webContents.once("did-stop-loading", finish);
      win?.webContents.once("did-fail-load", (_event, _errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame) {
          clearTimeout(timeout);
          reject(new Error(errorDescription || `Failed to load ${validatedUrl || targetUrl}`));
        }
      });
    });

    const loadPage = win.loadURL(targetUrl).then(() => undefined);
    await Promise.race([loadPage, waitForPage]);
    if (timedOut && !win.isDestroyed()) win.webContents.stop();
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    if (!win.isDestroyed()) {
      try {
        const domCandidates = await win.webContents.executeJavaScript(`
          (() => {
            const out = [];
            const push = (url, label, contentType) => {
              if (typeof url === "string" && url.trim()) out.push({ url, label, contentType });
            };
            for (const element of document.querySelectorAll("video, audio, source, track, img, a, link")) {
              push(element.currentSrc || element.src || element.href, element.tagName.toLowerCase(), element.type || "");
              if (element.srcset) {
                for (const part of element.srcset.split(",")) push(part.trim().split(/\\s+/)[0], "srcset", "");
              }
            }
            return out;
          })()
        `, true) as DomProbeCandidate[];
        for (const candidate of domCandidates) {
          try {
            const absolute = new URL(candidate.url, win.webContents.getURL()).toString();
            addProbeCandidate(candidates, absolute, "dom", "GET", candidate.contentType || undefined, candidate.label);
          } catch {
            undefined;
          }
        }
      } catch {
        undefined;
      }
    }

    return {
      ok: true,
      url: targetUrl,
      finalUrl: win?.webContents.getURL() || targetUrl,
      candidates: sortedProbeCandidates(candidates),
      timedOut,
    };
  } catch (error) {
    return {
      ok: false,
      url: targetUrl || String(inputUrl ?? ""),
      error: error instanceof Error ? error.message : String(error),
      candidates: sortedProbeCandidates(candidates),
      timedOut,
    };
  } finally {
    probeSession.webRequest.onBeforeRequest(filter, null);
    probeSession.webRequest.onHeadersReceived(filter, null);
    if (win && !win.isDestroyed()) win.destroy();
    await probeSession.clearStorageData().catch(() => undefined);
    requestMethods.clear();
  }
}

async function electronGoogleSearchEvidence(query: string, requestedPack: string, limit = 5, timeoutMs = SERP_SCOUT_TIMEOUT_MS): Promise<SearchEvidencePayload> {
  const safeQuery = query.trim().slice(0, 160);
  const safePack = requestedPack.trim() || "all";
  let win: BrowserWindow | null = null;
  let timedOut = false;
  const partition = `rippo-serp-scout:${randomUUID()}`;
  const serpSession = session.fromPartition(partition, { cache: false });

  const empty = (reason: string, error?: string): SearchEvidencePayload => ({
    enabled: false,
    source: "electron_google",
    provider: "electron_google",
    label: "Electron Google",
    query: safeQuery,
    requestedPack: safePack,
    results: [],
    resultCount: 0,
    reason,
    ...(error ? { error } : {}),
  });

  if (!safeQuery) return empty("Search evidence needs a query.");

  try {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", safeQuery);
    url.searchParams.set("num", String(Math.max(1, Math.min(limit + 4, 10))));
    url.searchParams.set("hl", process.env.RIPPO_SEARCH_LANG || "en");
    url.searchParams.set("safe", process.env.RIPPO_GOOGLE_SAFE || "active");
    url.searchParams.set("pws", "0");

    serpSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    serpSession.setPermissionCheckHandler(() => false);

    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        images: false,
      },
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error("Google SERP scout timed out."));
      }, timeoutMs);
    });

    try {
      await Promise.race([win.loadURL(url.toString()), timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    if (timedOut) throw new Error("Google SERP scout timed out.");
    await new Promise((resolve) => setTimeout(resolve, 700));

    const results = await win.webContents.executeJavaScript(`
      (() => {
        const limit = ${Math.max(1, Math.min(limit, 10))};
        const blockedMarkers = [
          "our systems have detected unusual traffic",
          "before you continue to google",
          "recaptcha",
          "sorry/index"
        ];
        const pageText = (document.body?.innerText || "").toLowerCase();
        if (blockedMarkers.some((marker) => pageText.includes(marker))) {
          return { blocked: true, results: [] };
        }
        const cleanText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
        const displayUrl = (value) => {
          try {
            const parsed = new URL(value);
            return parsed.hostname.replace(/^www\\./, "");
          } catch {
            return "";
          }
        };
        const isGoogleNoiseUrl = (value) => {
          try {
            const parsed = new URL(value);
            const host = parsed.hostname.toLowerCase();
            const path = parsed.pathname.toLowerCase();
            if (!parsed.protocol.startsWith("http")) return true;
            const blockedHosts = [
              "google.com",
              "www.google.com",
              "accounts.google.com",
              "support.google.com",
              "policies.google.com",
              "webcache.googleusercontent.com",
              "googleadservices.com",
              "doubleclick.net"
            ];
            if (blockedHosts.includes(host) || blockedHosts.some((blocked) => host.endsWith("." + blocked))) return true;
            return ["/aclk", "/shopping", "/preferences", "/setprefs"].some((part) => path.includes(part));
          } catch {
            return true;
          }
        };
        const targetFromHref = (href) => {
          if (!href) return "";
          let parsed;
          try {
            parsed = new URL(href, location.href);
          } catch {
            return "";
          }
          if (parsed.hostname.endsWith("google.com") && parsed.pathname === "/url") {
            return parsed.searchParams.get("q") || "";
          }
          if (parsed.pathname.startsWith("/search") || parsed.pathname.startsWith("/preferences") || parsed.pathname.startsWith("/support")) return "";
          return parsed.href;
        };
        const isInsideNoise = (element) => {
          let current = element;
          while (current && current !== document.body) {
            const attrs = [
              current.id,
              current.className,
              current.getAttribute?.("aria-label"),
              current.getAttribute?.("role"),
              current.getAttribute?.("data-text-ad"),
              Array.from(current.getAttributeNames?.() || []).join(" ")
            ].join(" ").toLowerCase();
            if (["sponsored", "ads-ad", "commercial-unit", "pla-unit", "shopping", "kp-blk", "knowledge-panel", "related-question", "people also ask", "data-text-ad"].some((marker) => attrs.includes(marker))) return true;
            current = current.parentElement;
          }
          return false;
        };
        const seen = new Set();
        const results = [];
        for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
          if (results.length >= limit) break;
          if (isInsideNoise(anchor)) continue;
          const url = targetFromHref(anchor.getAttribute("href"));
          if (!url || isGoogleNoiseUrl(url) || seen.has(url)) continue;
          const title = cleanText(anchor.querySelector("h3")?.innerText || anchor.innerText);
          if (!title || ["cached", "similar", "translate this page", "sponsored", "ad"].includes(title.toLowerCase())) continue;
          const block = anchor.closest(".g, [data-sokoban-container], div");
          const blockText = cleanText(block?.innerText || "");
          const snippet = cleanText(blockText.replace(title, "")).slice(0, 500);
          seen.add(url);
          results.push({
            title: title.slice(0, 180),
            url: url.slice(0, 500),
            displayUrl: displayUrl(url).slice(0, 180),
            snippet,
            position: results.length + 1
          });
        }
        return { blocked: false, results };
      })()
    `, true) as { blocked?: boolean; results?: SearchEvidenceResult[] };

    if (results.blocked) throw new Error("Google returned a consent, CAPTCHA, or unusual-traffic page.");
    const organic = Array.isArray(results.results) ? results.results : [];
    return {
      enabled: true,
      source: "electron_google",
      provider: "electron_google",
      label: "Electron Google",
      query: safeQuery,
      requestedPack: safePack,
      results: organic,
      resultCount: organic.length,
      reason: "Read Google search-result context through Electron Chromium before routing.",
    };
  } catch (error) {
    return empty("Electron Google evidence failed; falling back to engine providers.", error instanceof Error ? error.message : String(error));
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await serpSession.clearCache().catch(() => undefined);
    await serpSession.clearStorageData().catch(() => undefined);
  }
}

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
  const selectedOpenRouterModel = currentOpenRouterModel();
  fs.mkdirSync(path.dirname(appManagedYtDlpPath()), { recursive: true });
  return {
    ...process.env,
    PYTHONPATH: [fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : null, pythonPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    RIPPO_FFMPEG_PATH: bundledFfmpeg || process.env.RIPPO_FFMPEG_PATH || "",
    RIPPO_YTDLP_PATH: process.env.RIPPO_YTDLP_PATH || appManagedYtDlpPath(),
    RIPPO_GALLERYDL_ROOT: fs.existsSync(managedGalleryDlRoot) ? managedGalleryDlRoot : "",
    RIPPO_OPENROUTER_MODELS_CACHE: appManagedOpenRouterModelsCache(),
    OPENROUTER_MODEL: selectedOpenRouterModel,
  };
}

function engineCwd(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function runEngine(args: string[], onJson?: (payload: unknown) => void, envOverride: NodeJS.ProcessEnv = {}): Promise<unknown> {
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

function defaultOutputRoot(): string {
  return path.join(app.getPath("downloads"), "Rippo");
}

function currentOutputRoot(): string {
  const saved = readSettings().outputRoot;
  if (saved && typeof saved === "string" && saved.trim()) return saved;
  return defaultOutputRoot();
}

function currentOpenRouterModel(): string {
  const saved = readSettings().openRouterModel;
  if (saved && typeof saved === "string" && saved.trim()) return saved;
  return process.env.OPENROUTER_MODEL || "openrouter/free";
}

async function engineHealthPayload(): Promise<Record<string, unknown>> {
  const browsers = detectBrowsers();
  const source = defaultCookieSource(browsers);
  const health = (await runEngine(["health", ...cookieSourceArgs(source)])) as Record<string, unknown>;
  return {
    ...health,
    cookiesSupported: cookiesSupported(),
    cookiesBrowsers: browsers,
    cookiesBrowser: cookieSourceBrowserId(source),
    cookieSource: source,
    outputRoot: currentOutputRoot(),
    openRouterModel: currentOpenRouterModel(),
    openRouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()),
    searchEvidence: browserSerpEnabled()
      ? {
        configured: true,
        available: true,
        provider: "electron_google",
        label: "Electron Google",
        reason: "Uses Electron's bundled Chromium to read Google result context before routing.",
      }
      : health.searchEvidence,
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

  ipcMain.handle("page:probe", async (_event, url: string) => {
    if (activePageProbe) {
      return {
        ok: false,
        url,
        error: "A page scan is already running.",
        candidates: [],
      };
    }
    activePageProbe = probePage(url);
    try {
      return await activePageProbe;
    } finally {
      activePageProbe = null;
    }
  });

  ipcMain.handle("engine:source-search", async (_event, query?: string, pack?: string) => {
    const safeQuery = (typeof query === "string" ? query : "").slice(0, 120);
    const safePack = typeof pack === "string" && pack.trim() ? pack : "all";
    const searchKey = `${safePack}\n${safeQuery}`;
    if (activeSourceSearch) {
      if (activeSourceSearchKey === searchKey) return await activeSourceSearch;
      return {
        ok: false,
        query: safeQuery,
        pack: safePack,
        packs: [{ id: "all", label: "All" }],
        results: [],
        error: "Search is catching up.",
      };
    }
    try {
      activeSourceSearchKey = searchKey;
      activeSourceSearch = (async () => {
        const evidence = browserSerpEnabled()
          ? await electronGoogleSearchEvidence(safeQuery, safePack, 6)
          : null;
        const envOverride: NodeJS.ProcessEnv = {};
        if (browserSerpEnabled()) {
          envOverride.RIPPO_SERP_BROWSER = "0";
          if ((process.env.RIPPO_SEARCH_PROVIDER || "").trim().toLowerCase() === "electron_google") {
            envOverride.RIPPO_SEARCH_PROVIDER = "";
          }
        }
        if (evidence?.enabled) envOverride.RIPPO_SEARCH_EVIDENCE_JSON = JSON.stringify(evidence);
        return await runEngine(["source-search", "--query", safeQuery, "--pack", safePack, "--limit", "24"], undefined, envOverride);
      })();
      return await activeSourceSearch;
    } catch (error) {
      return {
        ok: false,
        query: safeQuery,
        pack: safePack,
        packs: [{ id: "all", label: "All" }],
        results: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      activeSourceSearch = null;
      activeSourceSearchKey = "";
    }
  });

  ipcMain.handle("ai:models", async (_event, refresh?: boolean) => {
    return await runEngine(["ai-models", "--selected-model", currentOpenRouterModel(), ...(refresh ? ["--refresh"] : [])]);
  });

  ipcMain.handle("ai:set-model", async (_event, modelId?: string) => {
    const model = typeof modelId === "string" && modelId.trim() ? modelId.trim().slice(0, 140) : "openrouter/free";
    const settings = readSettings();
    settings.openRouterModel = model;
    writeSettings(settings);
    return {
      model,
      health: await engineHealthPayload(),
      catalog: await runEngine(["ai-models", "--selected-model", model]),
    };
  });

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
