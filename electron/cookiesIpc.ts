import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  cookieSourceBrowserId,
  cookieSourceFromBrowserId,
  validateCookieSource,
  validateCookiesBrowserId,
  type BrowserInfo,
  type CookieSource,
} from "./cookies";
import { readSettings, writeSettings } from "./settingsStore";

export { cookieSourceBrowserId } from "./cookies";

export function detectBrowsers(): BrowserInfo[] {
  if (process.platform !== "darwin") return [];
  const candidates: { id: string; label: string; bundles: string[] }[] = [
    { id: "chrome", label: "Chrome", bundles: ["Google Chrome.app", "Google Chrome Canary.app"] },
    { id: "safari", label: "Safari", bundles: ["Safari.app"] },
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

export function cookiesSupported(): boolean {
  return process.platform === "darwin";
}

export function defaultCookieSource(browsers: BrowserInfo[] = detectBrowsers()): CookieSource {
  const settings = readSettings();
  try {
    if (settings.cookieSource) return validateCookieSource(settings.cookieSource, browsers);
    if (settings.cookiesBrowser) return cookieSourceFromBrowserId(settings.cookiesBrowser, browsers);
  } catch {
    return { mode: "off" };
  }
  return { mode: "off" };
}

export function cookieSourceFromInput(sourceInput: unknown): CookieSource {
  return validateCookieSource(sourceInput, detectBrowsers());
}

export function cookieSourceArgs(source: CookieSource): string[] {
  if (source.mode !== "browser") return [];
  return ["--cookies-browser", source.browserId];
}

export function cookiesResponse(browsers: BrowserInfo[] = detectBrowsers()) {
  const source = defaultCookieSource(browsers);
  return {
    browsers,
    selected: cookieSourceBrowserId(source),
    source,
    supported: cookiesSupported(),
  };
}

export function registerCookieIpcHandlers() {
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
}
