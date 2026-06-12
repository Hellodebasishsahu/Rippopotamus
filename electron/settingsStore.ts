import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { CookieSource } from "./cookies";

export type Settings = {
  cookieSource?: CookieSource;
  cookiesBrowser?: string;
  networkProxy?: string;
  outputRoot?: string;
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(next: Settings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}

export function defaultOutputRoot(): string {
  return path.join(app.getPath("downloads"), "Rippo");
}

export function currentOutputRoot(): string {
  const saved = readSettings().outputRoot;
  if (saved && typeof saved === "string" && saved.trim()) return saved;
  return defaultOutputRoot();
}

export function currentNetworkProxy(): string {
  const saved = readSettings().networkProxy;
  if (saved && typeof saved === "string" && saved.trim()) return saved.trim().slice(0, 400);
  return process.env.RIPPO_NETWORK_PROXY || "";
}

export function writeNetworkProxy(proxy: string): string {
  const normalized = proxy.trim().slice(0, 400);
  const settings = readSettings();
  if (normalized) settings.networkProxy = normalized;
  else delete settings.networkProxy;
  writeSettings(settings);
  return normalized;
}
