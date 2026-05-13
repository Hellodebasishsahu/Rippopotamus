#!/usr/bin/env node

const { spawnSync } = await import("node:child_process");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const ffmpeg = (await import("ffmpeg-static")).default;
const { decodeMediaPath, extractLibraryThumbnailWithDeps, pathToRippoMediaUrl } = await import("../dist-electron/mediaLibrary.js");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.includes("--semantic")) {
  throw new Error("Semantic media-library verification is disabled. Rebuild caption/object/transcript indexing before adding this back.");
}
if (!args[0] || !args[1]) {
  throw new Error("Usage: node scripts/verify-media-library-slice.mjs <real-media-root> <filename-query>");
}
const mediaRoot = path.resolve(args[0]);
const query = args[1];

const engineEnv = {
  ...process.env,
  PYTHONPATH: ["src", process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: engineEnv,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

if (!ffmpeg) {
  throw new Error("ffmpeg-static did not resolve a binary.");
}

if (!fs.existsSync(mediaRoot)) {
  throw new Error(`Media root does not exist: ${mediaRoot}`);
}

run("python", ["-m", "rippopotamus.desktop_engine", "index-ingest", "--index-root", mediaRoot, mediaRoot]);
const search = JSON.parse(run("python", ["-m", "rippopotamus.desktop_engine", "index-search", "--no-vector", "--index-root", mediaRoot, "--query", query, "--limit", "10"]));
if (!search.ok || search.resultCount < 1) {
  throw new Error(`Expected search results for ${query}, got ${search.resultCount || 0}.`);
}
if (search.queryEmbeddingSource) {
  throw new Error(`Expected filename/basic metadata search only, got query embedding source ${search.queryEmbeddingSource}.`);
}

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "rippo-media-library-"));
const checked = [];
for (const result of search.results) {
  const mediaUrl = pathToRippoMediaUrl(result.path);
  const decoded = decodeMediaPath(mediaUrl);
  if (decoded !== result.path) {
    throw new Error(`Media URL did not round-trip for ${result.path}.`);
  }
  const thumb = await extractLibraryThumbnailWithDeps(result.path, result.start ?? 0, {
    ffmpeg,
    cacheDir,
    timeoutMs: 5000,
  });
  if (!thumb || !fs.existsSync(thumb) || fs.statSync(thumb).size <= 0) {
    throw new Error(`Thumbnail extraction failed for ${result.path}.`);
  }
  checked.push({
    id: result.id,
    file: result.file,
    kind: result.kind,
    matchType: result.matchType,
    start: result.start ?? null,
    end: result.end ?? null,
  });
}

console.log(JSON.stringify({
  ok: true,
  mediaRoot,
  query,
  queryEmbeddingSource: search.queryEmbeddingSource ?? null,
  resultCount: search.resultCount,
  checked,
}, null, 2));
