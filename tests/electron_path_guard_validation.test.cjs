const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// pathGuard.ts is compiled to dist-electron/pathGuard.js by
// `tsc -p tsconfig.electron.json` (run `npm run build:electron` first).
const { resolveWithinRoots, assertWithinRoots } = require("../apps/desktop/dist-electron/pathGuard.js");

const ROOT = path.resolve("/a/lib");

test("accepts a file directly inside root", () => {
  assert.equal(resolveWithinRoots("/a/lib/video.mp4", [ROOT]), path.resolve("/a/lib/video.mp4"));
});

test("accepts a file in a nested subdir", () => {
  assert.equal(
    resolveWithinRoots("/a/lib/.rippo-private/2024/clip.mov", [ROOT]),
    path.resolve("/a/lib/.rippo-private/2024/clip.mov"),
  );
});

test("accepts the root itself", () => {
  assert.equal(resolveWithinRoots("/a/lib", [ROOT]), ROOT);
  // Trailing slash / dot segments normalize to the root too.
  assert.equal(resolveWithinRoots("/a/lib/", [ROOT]), ROOT);
  assert.equal(resolveWithinRoots("/a/lib/./sub/..", [ROOT]), ROOT);
});

test("rejects an absolute path outside the root", () => {
  assert.equal(resolveWithinRoots("/etc/passwd", [ROOT]), null);
});

test("rejects parent traversal out of the root", () => {
  assert.equal(resolveWithinRoots("/a/lib/../secret", [ROOT]), null);
  assert.equal(resolveWithinRoots("/a/lib/sub/../../secret", [ROOT]), null);
});

test("rejects a sibling dir sharing a name prefix (prefix bug)", () => {
  // The classic bug: naive startsWith("/a/lib") would wrongly accept "/a/library".
  assert.equal(resolveWithinRoots("/a/library/x", [ROOT]), null);
  assert.equal(resolveWithinRoots("/a/lib-extra/x", [ROOT]), null);
});

test("accepts when contained in at least one of several roots", () => {
  const other = path.resolve("/b/other");
  assert.equal(
    resolveWithinRoots("/b/other/file.png", [ROOT, other]),
    path.resolve("/b/other/file.png"),
  );
});

test("assertWithinRoots returns the resolved path when contained", () => {
  assert.equal(assertWithinRoots("/a/lib/x.png", [ROOT]), path.resolve("/a/lib/x.png"));
});

test("assertWithinRoots throws when outside", () => {
  assert.throws(
    () => assertWithinRoots("/etc/passwd", [ROOT]),
    /Refusing to access a path outside the library\./,
  );
});
