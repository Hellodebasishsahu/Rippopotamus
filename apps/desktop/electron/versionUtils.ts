// Shared by helperRegistry.ts (yt-dlp/gallery-dl updates) and appUpdatesIpc.ts
// (app self-update) — both compare dotted/dashed version strings the same way.

export function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^v/i, "") || null;
}

export function compareVersions(left: string, right: string): number {
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
