export type PageProbeCandidateKind = "video" | "audio" | "image" | "pdf" | "playlist" | "torrent" | "document" | "other";

export type PageProbeCandidate = {
  url: string;
  kind: PageProbeCandidateKind;
  type: PageProbeCandidateKind;
  label: string;
  source: "network" | "dom";
  method: string;
  score: number;
  contentType?: string;
};

export type PendingProbeCandidate = PageProbeCandidate & {
  order: number;
};

export const PAGE_PROBE_MAX_CANDIDATES = 200;

const extensionKindPatterns: { kind: PageProbeCandidateKind; pattern: RegExp }[] = [
  { kind: "playlist", pattern: /\.(?:m3u8|mpd)(?:[?#]|$)/i },
  { kind: "video", pattern: /\.(?:mp4|m4v|webm|mov|mkv|avi|3gp|ts)(?:[?#]|$)/i },
  { kind: "audio", pattern: /\.(?:mp3|m4a|aac|ogg|opus|wav|flac)(?:[?#]|$)/i },
  { kind: "image", pattern: /\.(?:jpg|jpeg|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i },
  { kind: "pdf", pattern: /\.pdf(?:[?#]|$)/i },
  { kind: "torrent", pattern: /\.torrent(?:[?#]|$)/i },
];

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

export function firstHeaderValue(headers: Record<string, string[] | string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!entry) return undefined;
  const value = entry[1];
  if (Array.isArray(value)) return value.find(Boolean);
  return value || undefined;
}

export function contentKind(contentType: string | undefined): PageProbeCandidateKind | null {
  const lower = contentType?.split(";")[0]?.trim().toLowerCase();
  if (!lower) return null;
  if (lower === "application/vnd.apple.mpegurl" || lower === "application/x-mpegurl" || lower === "application/dash+xml") return "playlist";
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("image/")) return "image";
  if (lower === "application/pdf") return "pdf";
  if (lower === "application/x-bittorrent") return "torrent";
  if (lower.includes("mpegurl") || lower.includes("dash+xml")) return "playlist";
  return null;
}

export function extensionKind(url: string): PageProbeCandidateKind | null {
  return extensionKindPatterns.find((entry) => entry.pattern.test(url))?.kind || null;
}

export function candidateKind(url: string, contentType?: string): PageProbeCandidateKind | null {
  return contentKind(contentType) || extensionKind(url);
}

export function candidateLabel(kind: PageProbeCandidateKind, url: string, contentType?: string): string {
  if (contentType) return contentType.split(";")[0].trim();
  if (kind === "playlist") return /\.mpd(?:[?#]|$)/i.test(url) ? "DASH playlist" : "HLS playlist";
  if (kind === "torrent") return "Torrent";
  return kind;
}

export function candidateScore(kind: PageProbeCandidateKind, source: PageProbeCandidate["source"], url: string, contentType?: string): number {
  let score = 10;
  if (source === "network") score += 10;
  if (contentType) score += 10;
  if (kind === "playlist") score += 40;
  if (kind === "video" || kind === "audio") score += 30;
  if (kind === "pdf" || kind === "torrent") score += 20;
  if (kind === "image") score += 8;
  if (/blob:|data:/i.test(url)) score -= 50;
  return score;
}

export function addProbeCandidate(
  candidates: Map<string, PendingProbeCandidate>,
  inputUrl: string,
  source: PageProbeCandidate["source"],
  method: string,
  contentType?: string,
  label?: string,
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
  const kind = candidateKind(url, contentType) || (parsed.protocol === "magnet:" ? "torrent" : null);
  if (!kind) return;
  const next: PendingProbeCandidate = {
    url,
    kind,
    type: kind,
    label: label || candidateLabel(kind, url, contentType),
    source,
    method,
    score: candidateScore(kind, source, url, contentType),
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
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, PAGE_PROBE_MAX_CANDIDATES)
    .map(({ order: _order, ...candidate }) => candidate);
}
