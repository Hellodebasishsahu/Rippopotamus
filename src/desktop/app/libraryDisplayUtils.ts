import type { IndexSearchResult, IndexStatusResponse } from "../../../electron/types";

export function formatMomentTime(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "";
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(hours ? 2 : 1, "0");
  const rest = (safe % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

export function momentRange(result: IndexSearchResult): string {
  const start = formatMomentTime(result.start);
  const end = formatMomentTime(result.end);
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return "Full file";
}

export function folderForPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : filePath;
}

export function indexStatusLine(status: IndexStatusResponse | null): string {
  if (!status) return "Not scanned yet";
  if (!status.assetCount && !status.momentCount) return "No saved footage scanned";
  return `${status.assetCount} files · ${status.momentCount} moments`;
}
