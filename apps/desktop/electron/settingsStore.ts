import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { CookieSource } from "./cookies";

export type Settings = {
  cookieSource?: CookieSource;
  cookiesBrowser?: string;
  outputRoot?: string;
  aria2MaxConnections?: number;
  aria2DownloadLimit?: string;
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

export type TransferSettings = {
  aria2MaxConnections: number;
  aria2DownloadLimit: string;
};

export function normalizeAria2MaxConnections(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(16, Math.floor(parsed)));
}

export function normalizeAria2DownloadLimit(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().slice(0, 24) : "";
  if (!normalized) return "";
  if (/^\d+(?:K|M)?$/i.test(normalized)) return normalized.toUpperCase();
  return "";
}

export function currentTransferSettings(): TransferSettings {
  const settings = readSettings();
  return {
    aria2MaxConnections: normalizeAria2MaxConnections(settings.aria2MaxConnections),
    aria2DownloadLimit: normalizeAria2DownloadLimit(settings.aria2DownloadLimit),
  };
}

export function writeTransferSettings(input: Partial<TransferSettings>): TransferSettings {
  const next = {
    aria2MaxConnections: normalizeAria2MaxConnections(input.aria2MaxConnections),
    aria2DownloadLimit: normalizeAria2DownloadLimit(input.aria2DownloadLimit),
  };
  const settings = readSettings();
  settings.aria2MaxConnections = next.aria2MaxConnections;
  if (next.aria2DownloadLimit) settings.aria2DownloadLimit = next.aria2DownloadLimit;
  else delete settings.aria2DownloadLimit;
  writeSettings(settings);
  return next;
}

export function transferEnv(settings: TransferSettings = currentTransferSettings()): NodeJS.ProcessEnv {
  return {
    RIPPO_ARIA2_MAX_CONNECTIONS: String(settings.aria2MaxConnections),
    RIPPO_ARIA2_DOWNLOAD_LIMIT: settings.aria2DownloadLimit,
  };
}
