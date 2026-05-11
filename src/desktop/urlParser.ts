const URL_PATTERN = /(?<![a-z0-9._%+-])(?:https?:\/\/|www\.)[^\s<>"'`]+|(?<![@a-z0-9._%+-])\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/[^\s<>"'`]*)?/gi;

const TRAILING_PUNCTUATION = /[)\]}.,!?;:]+$/;
const LEADING_PUNCTUATION = /^[([{<>"'`]+/;
const COMMON_TLDS = new Set([
  "app",
  "art",
  "co",
  "com",
  "dev",
  "edu",
  "fm",
  "gg",
  "gov",
  "in",
  "io",
  "me",
  "net",
  "org",
  "tv",
  "uk",
]);

function stripWrappingPunctuation(value: string): string {
  let next = value.trim().replace(LEADING_PUNCTUATION, "");
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

  const hasExplicitProtocol = /^https?:\/\//i.test(trimmed);
  const candidate = hasExplicitProtocol ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".")) return null;
    if (hasExplicitProtocol) return parsed.toString();
    const tld = parsed.hostname.toLowerCase().split(".").pop();
    if (!tld || !COMMON_TLDS.has(tld)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractUrls(value: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const match of value.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (value.slice(Math.max(0, index - 3), index) === "://") continue;
    const normalized = normalizeUrlCandidate(match[0]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}
