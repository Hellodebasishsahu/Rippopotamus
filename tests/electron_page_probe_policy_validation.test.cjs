const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addProbeCandidate,
  firstHeaderValue,
  sortedProbeCandidates,
  validateProbeUrl,
} = require("../dist-electron/pageProbePolicy.js");

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

test("firstHeaderValue reads response headers case insensitively", () => {
  assert.equal(firstHeaderValue({ "Content-Type": ["video/mp4"] }, "content-type"), "video/mp4");
  assert.equal(firstHeaderValue({ "content-type": "audio/mpeg" }, "Content-Type"), "audio/mpeg");
});

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

test("addProbeCandidate ignores non-downloadable blob data and script urls", () => {
  const candidates = new Map();
  addProbeCandidate(candidates, "blob:https://example.com/123", "dom", "GET", "video/mp4");
  addProbeCandidate(candidates, "data:video/mp4;base64,AAAA", "dom", "GET", "video/mp4");
  addProbeCandidate(candidates, "https://example.com/main.js", "network", "GET", "application/javascript");

  assert.deepEqual(sortedProbeCandidates(candidates), []);
});

test("addProbeCandidate blocks private-network media candidates", () => {
  const candidates = new Map();
  addProbeCandidate(candidates, "http://127.0.0.1/video.mp4", "network", "GET", "video/mp4");
  addProbeCandidate(candidates, "http://192.168.0.10/video.mp4", "network", "GET", "video/mp4");

  assert.deepEqual(sortedProbeCandidates(candidates), []);
});

test("addProbeCandidate caps collection before output sorting", () => {
  const candidates = new Map();
  for (let index = 0; index < 250; index += 1) {
    addProbeCandidate(candidates, `https://cdn.example.com/${index}.mp4`, "network", "GET", "video/mp4");
  }

  assert.equal(candidates.size, 200);
  assert.equal(sortedProbeCandidates(candidates).length, 200);
});
