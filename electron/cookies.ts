export type BrowserInfo = { id: string; label: string; appPath: string };

export function validateCookiesBrowserId(browserId: string | null, browsers: BrowserInfo[]): string | null {
  if (browserId === null) return null;
  if (browsers.some((browser) => browser.id === browserId)) return browserId;
  throw new Error("Unsupported browser selection.");
}
