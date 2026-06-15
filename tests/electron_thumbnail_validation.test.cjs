const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeThumbnailUrls } = require("../apps/desktop/dist-electron/thumbnails.js");

test("sanitizeThumbnailUrls accepts http and https thumbnail urls", () => {
  assert.deepEqual(
    sanitizeThumbnailUrls(["https://example.com/a.jpg", "http://example.com/b.jpg"]),
    ["https://example.com/a.jpg", "http://example.com/b.jpg"],
  );
});

test("sanitizeThumbnailUrls rejects non-web protocols", () => {
  assert.deepEqual(
    sanitizeThumbnailUrls(["file:///etc/passwd", "data:image/png;base64,abcd", "https://example.com/a.jpg"]),
    ["https://example.com/a.jpg"],
  );
});

test("sanitizeThumbnailUrls deduplicates candidates", () => {
  assert.deepEqual(
    sanitizeThumbnailUrls(["https://example.com/a.jpg", "https://example.com/a.jpg"]),
    ["https://example.com/a.jpg"],
  );
});
