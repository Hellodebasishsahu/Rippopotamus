import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { CookieSource } from "./cookies";

export type Settings = {
  cookieSource?: CookieSource;
  cookiesBrowser?: string;
  outputRoot?: string;
  openRouterModel?: string;
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

export function currentOpenRouterModel(): string {
  const saved = readSettings().openRouterModel;
  if (saved && typeof saved === "string" && saved.trim()) return saved;
  return process.env.OPENROUTER_MODEL || "openrouter/free";
}
