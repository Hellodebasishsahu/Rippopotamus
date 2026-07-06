export type PageProbeCandidateKind = "video" | "audio" | "image" | "pdf" | "playlist" | "torrent" | "document" | "other";

export type PageProbeCandidate = {
  url: string;
  kind: PageProbeCandidateKind;
  type: PageProbeCandidateKind;
  label: string;
  source: "network" | "dom" | "meta" | "embed";
  method: string;
  score: number;
  contentType?: string;
  resolution?: string;
};

export type PendingProbeCandidate = PageProbeCandidate & {
  order: number;
};

export const PAGE_PROBE_MAX_CANDIDATES = 200;

// ---------------------------------------------------------------------------
// Extension → kind mapping
// ---------------------------------------------------------------------------

const EXTENSION_KIND: { kind: PageProbeCandidateKind; pattern: RegExp }[] = [
  { kind: "playlist", pattern: /\.(?:m3u8|mpd)(?:[?#]|$)/i },
  { kind: "video", pattern: /\.(?:mp4|m4v|webm|mov|mkv|avi|3gp|flv|wmv|ogv)(?:[?#]|$)/i },
  { kind: "audio", pattern: /\.(?:mp3|m4a|aac|ogg|opus|wav|flac|wma)(?:[?#]|$)/i },
  { kind: "image", pattern: /\.(?:jpg|jpeg|png|gif|webp|avif|bmp|svg|tiff?)(?:[?#]|$)/i },
  { kind: "pdf", pattern: /\.pdf(?:[?#]|$)/i },
  { kind: "torrent", pattern: /\.torrent(?:[?#]|$)/i },
];

// ---------------------------------------------------------------------------
// Content-Type → kind mapping
// ---------------------------------------------------------------------------

const CONTENT_TYPE_MAP: [RegExp, PageProbeCandidateKind][] = [
  [/^application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)/i, "playlist"],
  [/mpegurl|dash\+xml/i, "playlist"],
  [/^video\//i, "video"],
  [/^audio\//i, "audio"],
  [/^image\//i, "image"],
  [/^application\/pdf$/i, "pdf"],
  [/^application\/x-bittorrent$/i, "torrent"],
];

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export function validateProbeUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw new Error("Enter a page URL.");
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid http or https page URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https page URLs can be probed.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Links with usernames or passwords cannot be probed.");
  }
  if (isLocalOrPrivateHost(parsed.hostname)) {
    throw new Error("Local and private network pages cannot be probed.");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function isAllowedProbePageUrl(input: URL | string): boolean {
  let parsed: URL;
  try {
    parsed = input instanceof URL ? input : new URL(input);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    !parsed.username &&
    !parsed.password &&
    !isLocalOrPrivateHost(parsed.hostname)
  );
}

export function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split(".").map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

export function firstHeaderValue(headers: Record<string, string[] | string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!entry) return undefined;
  const value = entry[1];
  if (Array.isArray(value)) return value.find(Boolean);
  return value || undefined;
}

// ---------------------------------------------------------------------------
// Kind detection
// ---------------------------------------------------------------------------

export function contentKind(contentType: string | undefined): PageProbeCandidateKind | null {
  const lower = contentType?.split(";")[0]?.trim().toLowerCase();
  if (!lower) return null;
  for (const [pattern, kind] of CONTENT_TYPE_MAP) {
    if (pattern.test(lower)) return kind;
  }
  return null;
}

export function extensionKind(url: string): PageProbeCandidateKind | null {
  return EXTENSION_KIND.find((entry) => entry.pattern.test(url))?.kind || null;
}

export function candidateKind(url: string, contentType?: string): PageProbeCandidateKind | null {
  return contentKind(contentType) || extensionKind(url);
}

// ---------------------------------------------------------------------------
// Content key extraction (for deduplication of translated/aliased pages)
// ---------------------------------------------------------------------------

export function probePageContentKey(input: URL | string): string | null {
  let parsed: URL;
  try {
    parsed = input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }
  const parts = parsed.pathname
    .split("/")
    .map((part) => decodeURIComponent(part).trim().toLowerCase())
    .filter(Boolean);
  const markers = new Set(["video", "videos", "watch", "post", "posts", "media", "item", "view", "reel", "reels", "clip", "clips", "short", "shorts"]);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!markers.has(parts[index])) continue;
    const slug = parts[index + 1];
    const xhId = slug.match(/(?:^|-)(xh[a-z0-9]+)$/i)?.[1];
    if (xhId) return `xh:${xhId.toLowerCase()}`;
    const numericId = slug.match(/(?:^|-)(\d{4,})$/)?.[1];
    if (numericId) return `${parts[index]}:${numericId}`;
    return `${parts[index]}:${slug}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Noise detection — hard rejection gates
// ---------------------------------------------------------------------------

const AD_HOST_PATTERN = /(^|\.)(tsyndicate|exoclick|juicyads|popads|propellerads|adsterra|doubleclick|googlesyndication|googletagmanager|google-analytics|googleadservices|adnxs|adsrvr|trafficjunky|outbrain|taboola|mgid|scorecardresearch|histats|yadro|moatads|serving-sys|2mdn|rubiconproject|pubmatic|openx|casalemedia|criteo|amazon-adsystem|quantserve|bluekai|krxd|bidswitch|contextweb|spotxchange|smartadserver|adform|bidgear|clickagy|adcolony|admarvel|admob|aps\.amazon|branch\.io|chartbeat|comscore|crazyegg|demdex|everesttech|eyeota|hotjar|iponweb|lotame|mediamath|mixpanel|narrative\.io|nativo|nr-data|omtrdc|optimizely|pardot|rtmark|sizmek|teads|thetradedesk|tidaltv|truoptik|turn\.com|urbanairship|yieldmo)\./i;
const AD_PATH_PATTERN = /\/(?:ads?|vast|vpaid|prebid|banner|popunder|analytics|pixel|track(?:ing)?|beacon|telemetry|collect|log(?:ging)?|impression|click|pxl|evt|__imp)(?:[/?#._-]|$)/i;

export function isLikelyAdOrTrackingUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return AD_HOST_PATTERN.test(parsed.hostname.toLowerCase()) || AD_PATH_PATTERN.test(parsed.pathname.toLowerCase());
}

export function isLikelyHlsMediaSegment(url: string, contentType?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  const name = path.split("/").pop() || "";
  const type = contentType?.split(";")[0]?.trim().toLowerCase() || "";
  return (
    type === "video/mp2t" ||
    type === "video/iso.segment" ||
    type === "audio/iso.segment" ||
    /\.(?:ts|m4s|cmfv|cmfa)(?:$|[?#])/i.test(path) ||
    /^(?:seg|segment|frag|fragment|chunk|init)[-_]?\d/i.test(name) ||
    /(?:^|[._-])seg[-_]?\d/i.test(name)
  );
}

export function isLikelyThumbnailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const name = path.split("/").pop() || "";
    return (
      /\/thumb(?:s|nail)?s?[/._-]/i.test(path) ||
      /(?:^|[._-])(?:thumb|poster|preview|placeholder|sprite)(?:[._-]|$)/i.test(name) ||
      /\.t\.(?:av1\.)?mp4(?:[?#]|$)/i.test(path) ||
      /\/(?:\d{2,4}x\d{2,4}|default|maxresdefault|hqdefault|mqdefault|sddefault)\./i.test(path) ||
      /\/(?:ic|thumb)-[^/]*cdn\.com\//i.test(url)
    );
  } catch {
    return false;
  }
}

export function isLikelyPlayerArtifact(url: string): boolean {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").pop() || "").toLowerCase();
    return (
      /^_?tpl_?/.test(name) ||
      /^\d{3,4}p\.(?:av1|h264|h265|hevc)\.(?:mp4|webm|m4v)$/.test(name) ||
      /(?:^|[._-])(?:vast|vpaid|ad|ads|banner|prebid)(?:[._-]|$)/.test(name)
    );
  } catch {
    return false;
  }
}

export function isRejectedUrl(url: string, contentType?: string): boolean {
  if (/^(?:blob|data):/i.test(url)) return true;
  if (isLikelyAdOrTrackingUrl(url)) return true;
  if (isLikelyHlsMediaSegment(url, contentType)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function candidateLabel(kind: PageProbeCandidateKind, url: string, contentType?: string): string {
  if (contentType) {
    const base = contentType.split(";")[0].trim();
    if (kind === "playlist") {
      if (/mpd/i.test(url)) return "DASH manifest";
      return "HLS manifest";
    }
    return base;
  }
  if (kind === "playlist") return /\.mpd(?:[?#]|$)/i.test(url) ? "DASH manifest" : "HLS manifest";
  if (kind === "torrent") return "Torrent";
  return kind;
}

// ---------------------------------------------------------------------------
// Scoring — tier-based with hard gates
// ---------------------------------------------------------------------------
//
// Tier 1 (90-100): Master playlists from network with content-type
// Tier 2 (70-89):  Direct video/audio from network with content-type
// Tier 3 (50-69):  Video/audio by extension, or from DOM/meta with type
// Tier 4 (30-49):  PDF, torrent, document
// Tier 5 (10-29):  Images — thumbnails kept but ranked lowest (10), other images 20
// Rejected (≤0):   Segments, ads, blob/data, non-media
// ---------------------------------------------------------------------------

export function candidateScore(kind: PageProbeCandidateKind, source: PageProbeCandidate["source"], url: string, contentType?: string): number {
  if (isRejectedUrl(url, contentType)) return -1;
  if (isLikelyPlayerArtifact(url)) return -1;

  let score: number;
  switch (kind) {
    case "playlist":
      score = source === "network" && contentType ? 100 : 85;
      break;
    case "video":
    case "audio":
      // Embeds resolved through the engine (yt-dlp/gallery-dl) are confirmed,
      // directly downloadable media — rank them just under master playlists.
      if (source === "embed") score = 88;
      else if (source === "network" && contentType) score = 80;
      else if (source === "meta") score = 75;
      else if (contentType) score = 65;
      else score = 55;
      break;
    case "pdf":
    case "torrent":
      score = contentType ? 45 : 35;
      break;
    case "document":
      score = 30;
      break;
    case "image":
      // Previews/thumbnails are kept (the user asked for "media under preview")
      // but ranked below real video/audio so they never crowd out strong media.
      score = isLikelyThumbnailUrl(url) ? 10 : 20;
      break;
    default:
      score = 10;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Candidate collection
// ---------------------------------------------------------------------------

export function addProbeCandidate(
  candidates: Map<string, PendingProbeCandidate>,
  inputUrl: string,
  source: PageProbeCandidate["source"],
  method: string,
  contentType?: string,
  label?: string,
  kindOverride?: PageProbeCandidateKind,
): void {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "magnet:") return;
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !isAllowedProbePageUrl(parsed)) return;

  const url = parsed.toString();
  const kind = kindOverride || candidateKind(url, contentType) || (parsed.protocol === "magnet:" ? "torrent" : null);
  if (!kind) return;

  const score = candidateScore(kind, source, url, contentType);
  if (score <= 0) return;

  const next: PendingProbeCandidate = {
    url,
    kind,
    type: kind,
    label: label || candidateLabel(kind, url, contentType),
    source,
    method,
    score,
    contentType,
    order: candidates.size,
  };

  const existing = candidates.get(url);
  if (!existing && candidates.size >= PAGE_PROBE_MAX_CANDIDATES) return;
  if (!existing || next.score > existing.score || (!existing.contentType && next.contentType)) {
    candidates.set(url, { ...existing, ...next, order: existing?.order ?? next.order });
  }
}

export function sortedProbeCandidates(candidates: Map<string, PendingProbeCandidate>): PageProbeCandidate[] {
  return Array.from(candidates.values())
    .filter((c) => c.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, PAGE_PROBE_MAX_CANDIDATES)
    .map(({ order: _order, ...candidate }) => candidate);
}

// ---------------------------------------------------------------------------
// Aggregate helpers used by the UI
// ---------------------------------------------------------------------------

const STRONG_KINDS = new Set<PageProbeCandidateKind>(["playlist", "video", "audio", "torrent", "pdf"]);

export function isStrongCandidate(candidate: PageProbeCandidate): boolean {
  return STRONG_KINDS.has(candidate.kind) && candidate.score >= 40;
}

export function hasStrongMedia(candidates: PageProbeCandidate[]): boolean {
  return candidates.some(isStrongCandidate);
}
