const URL_PATTERN = /(?<![a-z0-9._%+-])magnet:\?[^\s<>"'`]+|(?<![a-z0-9._%+-])(?:https?:\/\/|\/\/|www\.)[^\s<>"'`]+|(?<![@a-z0-9._%+-])\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:[/?#][^\s<>"'`]*)?/gi;

const TRAILING_PUNCTUATION = /[)\]}.,!?;:]+$/;
const LEADING_PUNCTUATION = /^[([{<>"'`]+/;
const COMMON_TLDS = new Set([
  "app",
  "art",
  "co",
  "com",
  "dev",
  "desi",
  "digital",
  "edu",
  "fm",
  "gg",
  "gov",
  "in",
  "io",
  "me",
  "net",
  "org",
  "site",
  "tv",
  "uk",
  "world",
  "xyz",
]);

function unescapePastedUrlText(value: string): string {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&");
}

function stripWrappingPunctuation(value: string): string {
  let next = unescapePastedUrlText(value).trim().replace(LEADING_PUNCTUATION, "");
  while (TRAILING_PUNCTUATION.test(next)) {
    const before = next;
    next = next.replace(TRAILING_PUNCTUATION, "");
    if (next === before) break;
  }
  return next;
}

export function normalizeUrlCandidate(value: string): string | null {
  const trimmed = stripWrappingPunctuation(value);
  if (!trimmed) return null;

  if (/^magnet:\?/i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "magnet:" && parsed.searchParams.has("xt") ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  const hasExplicitProtocol = /^https?:\/\//i.test(trimmed);
  const hasProtocolRelative = /^\/\//.test(trimmed);
  const candidate = hasExplicitProtocol ? trimmed : hasProtocolRelative ? `https:${trimmed}` : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".")) return null;
    if (hasExplicitProtocol) return parsed.toString();
    const tld = parsed.hostname.toLowerCase().split(".").pop();
    const hasPathOrQuery = parsed.pathname !== "/" || Boolean(parsed.search || parsed.hash);
    if (!tld || (!COMMON_TLDS.has(tld) && (!hasPathOrQuery || !/^[a-z]{2,24}$/.test(tld)))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// Should this URL be probed for playlist/channel expansion? Conservative on
// purpose — a false positive just costs one cheap flat-playlist call that the
// engine falls through when it isn't actually a container. YouTube is the
// dominant case; other platforms use the generic path keywords.
// ponytail: YouTube-first heuristic; widen per-platform when users ask.
export function isPlaylistUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;
  if (host.endsWith("youtube.com") || host === "youtu.be") {
    if (path.startsWith("/playlist")) return true;
    if (/^\/(@[^/]+|channel\/|c\/|user\/)/.test(path)) return true;
    // watch?v=X&list=Y is a video that happens to sit in a list -> single item.
    // A bare ?list=... (no v) is the playlist itself.
    return u.searchParams.has("list") && !u.searchParams.has("v");
  }
  return /\/(playlist|playlists|sets|album)\b/i.test(path);
}

export function extractUrls(value: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const normalizedInput = unescapePastedUrlText(value);

  for (const match of normalizedInput.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (normalizedInput.slice(Math.max(0, index - 3), index) === "://") continue;
    if (match[0].startsWith("//") && normalizedInput[index - 1] === ":") continue;
    const normalized = normalizeUrlCandidate(match[0]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}
