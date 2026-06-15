const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const MAX_THUMBNAIL_CANDIDATES = 8;

export type ThumbnailLoadResult = {
  src: string | null;
  url: string | null;
};

export function sanitizeThumbnailUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length > 4096) continue;
    try {
      const parsed = new URL(item);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      const url = parsed.toString();
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= MAX_THUMBNAIL_CANDIDATES) break;
    } catch {
      continue;
    }
  }
  return urls;
}

function thumbnailHeaders(url: string): Record<string, string> {
  const host = new URL(url).hostname;
  const headers: Record<string, string> = {
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Rippopotamus/1.0 Safari/537.36",
  };

  if (host.includes("cdninstagram.com") || host.includes("fbcdn.net")) {
    headers.Referer = "https://www.instagram.com/";
  }

  return headers;
}

async function fetchThumbnailDataUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: thumbnailHeaders(url),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Thumbnail request failed: ${response.status}`);

  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > MAX_THUMBNAIL_BYTES) throw new Error("Thumbnail is too large.");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_THUMBNAIL_BYTES) throw new Error("Thumbnail is too large.");

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) throw new Error(`Thumbnail is not an image: ${contentType}`);

  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

export async function loadThumbnail(value: unknown): Promise<ThumbnailLoadResult> {
  const urls = sanitizeThumbnailUrls(value);
  for (const url of urls) {
    try {
      return { src: await fetchThumbnailDataUrl(url), url };
    } catch {
      continue;
    }
  }
  return { src: null, url: null };
}
