const TECHNICAL_MESSAGE_PATTERNS = [
  /\bCUID#/i,
  /\bException:/i,
  /\berrorCode=\d+/i,
  /\bHttpSkipResponseCommand/i,
  /\bDHTRoutingTable/i,
  /\bdht\.dat\b/i,
  /\/Users\//i,
  /\baria2c?\b/i,
  /\byt-dlp\b/i,
  /\bgallery-dl\b/i,
];

export function consumerErrorMessage(message: string, fallback = "Download failed. Try again or use another link."): string {
  const cleaned = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  const lower = cleaned.toLowerCase();

  if (
    lower.includes("your network is blocking") ||
    lower.includes("connection reset by peer") ||
    lower.includes("curl: (35)") ||
    lower.includes("airtel.in/dot")
  ) {
    return "Your network is blocking this site. Turn on a VPN (Settings → Network access) and try again.";
  }
  if (/unsupported url/i.test(cleaned)) {
    return "This link is not supported yet.";
  }
  if (lower.includes("restart rippopotamus") && lower.includes("updater")) {
    return "Restart Rippopotamus to load the update tool.";
  }
  if (lower.includes("requested format is not available") || lower.includes("selected format is not available")) {
    return "This link does not have that format. Choose another format and try again.";
  }
  if (lower.includes("status=500") || lower.includes("response status is not successful") || lower.includes("source is having trouble")) {
    return "The source is having trouble right now. Try again later or use another link.";
  }
  if (lower.includes("download aborted") || lower.includes("download stopped before it finished")) {
    return "The download stopped before it finished. Try again later or use another link.";
  }
  if (lower.includes("dht routing table") || lower.includes("routing cache")) {
    return "The download needs a retry before it can start.";
  }
  if (lower.includes("http error 403") || lower.includes("access denied") || lower.includes("forbidden")) {
    return "This source blocked the download. Try browser login or another link.";
  }
  if (lower.includes("http error 404") || lower.includes("not found")) {
    return "This source is no longer available.";
  }
  if (lower.includes("missing required command") && lower.includes("aria2")) {
    return "Install aria2c for reliable transfers and torrent links.";
  }
  if (lower.includes("torrent support needs")) {
    return "Install aria2c for reliable transfers and torrent links.";
  }
  if (lower.includes("missing") && lower.includes("gallery-dl")) {
    return "Image support is not installed yet.";
  }
  if (lower.includes("missing") && lower.includes("yt-dlp")) {
    return "Video support is not installed yet.";
  }
  if (!cleaned || TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return fallback;
  }
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

export function engineToolMessage(message: string, engine: "aria2c"): string {
  const lower = message.toLowerCase().trim();
  if (
    lower.includes("missing")
    || lower.includes("not on path")
    || lower.includes("torrent support needs")
    || lower.includes("not installed")
  ) {
    return "Not installed. Install aria2c or add it to PATH.";
  }
  if (lower.includes("not executable") || lower.includes("configured")) {
    return "Configured binary is missing or not executable.";
  }
  return consumerErrorMessage(message, "aria2c could not be verified.");
}

export function consumerNoticeMessage(message: string): string | null {
  const cleaned = message.trim();
  const lower = cleaned.toLowerCase();
  if (!cleaned) return null;
  if (
    lower.includes("fresh torrent routing cache") ||
    lower.includes("torrent source returned an error") ||
    lower.includes("retrying if possible") ||
    lower.includes("dht routing table") ||
    lower.includes("status=500") ||
    lower.includes("download aborted") ||
    TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned))
  ) {
    return null;
  }
  return consumerErrorMessage(cleaned, "");
}
