const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const { decodeMediaPath, extractLibraryThumbnailWithDeps, fetchMediaFileWithDeps, pathToRippoMediaUrl } = require("../dist-electron/mediaLibrary.js");

test("pathToRippoMediaUrl round trips absolute media paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rippo-media-"));
  const media = path.join(dir, "booth crowd line.mp4");
  fs.writeFileSync(media, "fake media");

  const url = pathToRippoMediaUrl(media);

  assert.equal(url.startsWith("rippo-media://local/"), true);
  assert.equal(decodeMediaPath(url), media);
});

test("decodeMediaPath rejects missing files and non rippo-media urls", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rippo-media-"));
  const missing = path.join(dir, "missing.mp4");

  assert.equal(decodeMediaPath(pathToRippoMediaUrl(missing)), null);
  assert.equal(decodeMediaPath("file:///etc/passwd"), null);
  assert.equal(decodeMediaPath("https://example.com/video.mp4"), null);
});

test("fetchMediaFileWithDeps fetches file urls through custom protocol bypass", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rippo-fetch-"));
  const media = path.join(dir, "booth crowd line.mp4");
  fs.writeFileSync(media, "fake media");
  const calls = [];
  const response = { ok: true };

  const result = await fetchMediaFileWithDeps(media, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response;
    },
  });

  assert.equal(result, response);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, pathToFileURL(media).href);
  assert.deepEqual(calls[0].init, { bypassCustomProtocolHandlers: true });
});

test("extractLibraryThumbnailWithDeps creates and reuses a cached thumbnail", async () => {
  const ffmpeg = require("ffmpeg-static");
  assert.ok(ffmpeg, "ffmpeg-static should resolve a binary");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rippo-thumb-"));
  const video = path.join(dir, "booth-crowd-line.mp4");
  const cacheDir = path.join(dir, "thumbs");
  const result = spawnSync(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=size=160x90:rate=5:duration=1",
    "-pix_fmt", "yuv420p",
    video,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  const first = await extractLibraryThumbnailWithDeps(video, 0, { ffmpeg, cacheDir, timeoutMs: 5000 });
  const second = await extractLibraryThumbnailWithDeps(video, 0, { ffmpeg, cacheDir, timeoutMs: 5000 });

  assert.ok(first);
  assert.equal(first, second);
  assert.equal(fs.existsSync(first), true);
  assert.ok(fs.statSync(first).size > 0);
});

test("extractLibraryThumbnailWithDeps creates a thumbnail for image results", async () => {
  const ffmpeg = require("ffmpeg-static");
  assert.ok(ffmpeg, "ffmpeg-static should resolve a binary");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rippo-image-thumb-"));
  const image = path.join(dir, "booth-map.png");
  const cacheDir = path.join(dir, "thumbs");
  const result = spawnSync(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=green:s=160x90",
    "-frames:v", "1",
    image,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  const thumb = await extractLibraryThumbnailWithDeps(image, 0, { ffmpeg, cacheDir, timeoutMs: 5000 });

  assert.ok(thumb);
  assert.equal(fs.existsSync(thumb), true);
  assert.ok(fs.statSync(thumb).size > 0);
});

test("extractLibraryThumbnailWithDeps rejects missing files and missing ffmpeg", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rippo-thumb-"));
  const missing = path.join(dir, "missing.mp4");

  assert.equal(await extractLibraryThumbnailWithDeps(missing, 0, { ffmpeg: "/bin/echo", cacheDir: dir }), null);
  assert.equal(await extractLibraryThumbnailWithDeps(__filename, 0, { ffmpeg: null, cacheDir: dir }), null);
});
