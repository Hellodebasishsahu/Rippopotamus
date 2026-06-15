export type BrowserInfo = { id: string; label: string; appPath: string };

export type CookieSource = {
  mode: "off";
} | {
  mode: "browser";
  browserId: string;
};

export function validateCookiesBrowserId(browserId: string | null, browsers: BrowserInfo[]): string | null {
  if (browserId === null) return null;
  if (browsers.some((browser) => browser.id === browserId)) return browserId;
  throw new Error("Unsupported browser selection.");
}

export function cookieSourceBrowserId(source: CookieSource): string | null {
  return source.mode === "browser" ? source.browserId : null;
}

export function cookieSourceFromBrowserId(browserId: string | null, browsers: BrowserInfo[]): CookieSource {
  const selected = validateCookiesBrowserId(browserId, browsers);
  return selected ? { mode: "browser", browserId: selected } : { mode: "off" };
}

export function validateCookieSource(source: unknown, browsers: BrowserInfo[]): CookieSource {
  if (source === null || source === undefined) return { mode: "off" };
  if (typeof source !== "object") throw new Error("Unsupported cookie source.");

  const candidate = source as { mode?: unknown; browserId?: unknown };
  if (candidate.mode === "off") return { mode: "off" };
  if (candidate.mode === "browser" && typeof candidate.browserId === "string") {
    return cookieSourceFromBrowserId(candidate.browserId, browsers);
  }
  throw new Error("Unsupported cookie source.");
}
