const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addProbeCandidate,
  candidateScore,
  firstHeaderValue,
  hasStrongMedia,
  isLikelyAdOrTrackingUrl,
  isLikelyHlsMediaSegment,
  isLikelyThumbnailUrl,
  isRejectedUrl,
  probePageContentKey,
  sortedProbeCandidates,
  validateProbeUrl,
} = require("../dist-electron/pageProbePolicy.js");

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

test("validateProbeUrl accepts public http and https page urls", () => {
  assert.equal(validateProbeUrl("https://example.com/watch#section"), "https://example.com/watch");
  assert.equal(validateProbeUrl("http://example.com/a?b=1"), "http://example.com/a?b=1");
});

test("validateProbeUrl rejects local private and credentialed urls", () => {
  assert.throws(() => validateProbeUrl("file:///etc/passwd"), /http and https/);
  assert.throws(() => validateProbeUrl("http://localhost:3000"), /Local and private/);
  assert.throws(() => validateProbeUrl("http://127.0.0.1:3000"), /Local and private/);
  assert.throws(() => validateProbeUrl("http://192.168.0.5/video"), /Local and private/);
  assert.throws(() => validateProbeUrl("https://user:pass@example.com/video"), /usernames or passwords/);
});

// ---------------------------------------------------------------------------
// Content key deduplication
// ---------------------------------------------------------------------------

test("probePageContentKey dedupes translated copies of the same media page", () => {
  assert.equal(probePageContentKey("https://xhamster.desi/videos/desi-group-sex-xhRj3hl"), "xh:xhrj3hl");
  assert.equal(probePageContentKey("https://xhamster.desi/hi/videos/translated-title-xhRj3hl?lang=hi"), "xh:xhrj3hl");
  assert.notEqual(
    probePageContentKey("https://xhamster.desi/videos/desi-group-sex-xhRj3hl"),
    probePageContentKey("https://xhamster.desi/videos/another-gallery-item-xh99999"),
  );
});

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

test("firstHeaderValue reads response headers case insensitively", () => {
  assert.equal(firstHeaderValue({ "Content-Type": ["video/mp4"] }, "content-type"), "video/mp4");
  assert.equal(firstHeaderValue({ "content-type": "audio/mpeg" }, "Content-Type"), "audio/mpeg");
});

// ---------------------------------------------------------------------------
// Candidate classification and scoring
// ---------------------------------------------------------------------------

test("addProbeCandidate classifies media by content type and extension", () => {
  const candidates = new Map();
  addProbeCandidate(candidates, "https://cdn.example.com/master.m3u8", "network", "GET");
  addProbeCandidate(candidates, "https://cdn.example.com/video?id=1", "network", "GET", "video/mp4; charset=binary");
  addProbeCandidate(candidates, "https://cdn.example.com/app.js", "network", "GET", "application/javascript");

  const sorted = sortedProbeCandidates(candidates);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].kind, "playlist");
  assert.equal(sorted[1].kind, "video");
});

test("playlists from network with content-type score highest (tier 1)", () => {
  const score = candidateScore("playlist", "network", "https://cdn.example.com/master.m3u8", "application/vnd.apple.mpegurl");
  assert.ok(score >= 90, `expected >= 90, got ${score}`);
});

test("video from network with content-type scores tier 2", () => {
  const score = candidateScore("video", "network", "https://cdn.example.com/video.mp4", "video/mp4");
  assert.ok(score >= 70 && score < 90, `expected 70-89, got ${score}`);
});

test("video from meta source scores well", () => {
  const score = candidateScore("video", "meta", "https://cdn.example.com/video.mp4");
  assert.ok(score >= 60, `expected >= 60, got ${score}`);
});

// ---------------------------------------------------------------------------
// Noise rejection — hard gates
// ---------------------------------------------------------------------------

test("blob and data URIs are hard-rejected (score <= 0)", () => {
  assert.ok(candidateScore("video", "dom", "blob:https://example.com/123", "video/mp4") <= 0);
  assert.ok(candidateScore("video", "dom", "data:video/mp4;base64,AAAA", "video/mp4") <= 0);
});

test("addProbeCandidate never adds blob or data URIs", () => {
  const candidates = new Map();
  addProbeCandidate(candidates, "blob:https://example.com/123", "dom", "GET", "video/mp4");
  addProbeCandidate(candidates, "data:video/mp4;base64,AAAA", "dom", "GET", "video/mp4");
  assert.equal(candidates.size, 0);
});

test("HLS media segments are hard-rejected", () => {
  assert.ok(isRejectedUrl("https://cdn.example.com/hls/seg-2-v1-a1.ts", "video/mp2t"));
  assert.ok(isRejectedUrl("https://cdn.example.com/hls/chunk12.m4s"));

  const candidates = new Map();
  addProbeCandidate(candidates, "https://cdn.example.com/hls/master.m3u8", "network", "GET");
  addProbeCandidate(candidates, "https://cdn.example.com/hls/seg-2-v1-a1.ts", "network", "GET", "video/mp2t");
  addProbeCandidate(candidates, "https://cdn.example.com/hls/chunk12.m4s", "network", "GET");

  const sorted = sortedProbeCandidates(candidates);
  assert.equal(sorted.length, 1, "only the master playlist should survive");
  assert.equal(sorted[0].kind, "playlist");
});

test("ad network URLs are hard-rejected", () => {
  assert.ok(isRejectedUrl("https://svacdn.tsyndicate.com/video.mp4"));
  assert.ok(isRejectedUrl("https://ad.doubleclick.net/vast"));

  const candidates = new Map();
  addProbeCandidate(candidates, "https://cdn.example.com/master.m3u8", "network", "GET");
  addProbeCandidate(candidates, "https://svacdn.tsyndicate.com/video.mp4", "network", "GET", "video/mp4");

  const sorted = sortedProbeCandidates(candidates);
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].url, "https://cdn.example.com/master.m3u8");
});

test("expanded ad network list catches more trackers", () => {
  assert.ok(isLikelyAdOrTrackingUrl("https://pixel.quantserve.com/pixel"));
  assert.ok(isLikelyAdOrTrackingUrl("https://cdn.criteo.com/banner.js"));
  assert.ok(isLikelyAdOrTrackingUrl("https://example.com/beacon/collect"));
  assert.ok(isLikelyAdOrTrackingUrl("https://example.com/api/impression?id=1"));
});

// ---------------------------------------------------------------------------
// Thumbnail detection
// ---------------------------------------------------------------------------

test("thumbnail URLs are detected and scored low", () => {
  assert.ok(isLikelyThumbnailUrl("https://cdn.example.com/thumbnails/thumb_001.jpg"));
  assert.ok(isLikelyThumbnailUrl("https://cdn.example.com/poster-large.jpg"));
  assert.ok(isLikelyThumbnailUrl("https://cdn.example.com/video.t.av1.mp4"));
  assert.ok(isLikelyThumbnailUrl("https://i.ytimg.com/vi/abc/maxresdefault.jpg"));

  const score = candidateScore("image", "network", "https://cdn.example.com/thumbnails/thumb_001.jpg", "image/jpeg");
  assert.ok(score <= 10, `thumbnail should score very low, got ${score}`);
});

// ---------------------------------------------------------------------------
// Private network blocking
// ---------------------------------------------------------------------------

test("addProbeCandidate blocks private-network media candidates", () => {
  const candidates = new Map();
  addProbeCandidate(candidates, "http://127.0.0.1/video.mp4", "network", "GET", "video/mp4");
  addProbeCandidate(candidates, "http://192.168.0.10/video.mp4", "network", "GET", "video/mp4");
  assert.deepEqual(sortedProbeCandidates(candidates), []);
});

// ---------------------------------------------------------------------------
// Collection cap
// ---------------------------------------------------------------------------

test("addProbeCandidate caps collection before output sorting", () => {
  const candidates = new Map();
  for (let index = 0; index < 250; index += 1) {
    addProbeCandidate(candidates, `https://cdn.example.com/${index}.mp4`, "network", "GET", "video/mp4");
  }
  assert.equal(candidates.size, 200);
  assert.equal(sortedProbeCandidates(candidates).length, 200);
});

// ---------------------------------------------------------------------------
// Aggregate helpers
// ---------------------------------------------------------------------------

test("hasStrongMedia correctly identifies strong candidate lists", () => {
  const strong = [{ kind: "playlist", score: 85 }];
  const weak = [{ kind: "image", score: 15 }];
  const mixed = [{ kind: "video", score: 80 }, { kind: "image", score: 15 }];

  assert.ok(hasStrongMedia(strong));
  assert.ok(!hasStrongMedia(weak));
  assert.ok(hasStrongMedia(mixed));
});

// ---------------------------------------------------------------------------
// Non-media scripts are still excluded
// ---------------------------------------------------------------------------

test("addProbeCandidate ignores non-downloadable script urls", () => {
  const candidates = new Map();
  addProbeCandidate(candidates, "https://example.com/main.js", "network", "GET", "application/javascript");
  assert.deepEqual(sortedProbeCandidates(candidates), []);
});
