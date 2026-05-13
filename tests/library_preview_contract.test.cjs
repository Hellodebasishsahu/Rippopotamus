const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

function loadLibraryPreviewModule() {
  const sourcePath = path.join(__dirname, "..", "src", "desktop", "app", "libraryPreview.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require,
  }, { filename: sourcePath });
  return module.exports;
}

const preview = loadLibraryPreviewModule();

test("library preview expands playable media and collapses the current result", () => {
  const result = { id: "moment-1", kind: "video" };

  assert.equal(preview.nextExpandedLibraryId(null, result), "moment-1");
  assert.equal(preview.nextExpandedLibraryId("moment-1", result), null);
});

test("library preview leaves non-media results closed", () => {
  const result = { id: "moment-1", kind: "document" };

  assert.equal(preview.libraryPreviewKind(result), null);
  assert.equal(preview.isLibraryResultPlayable(result), false);
  assert.equal(preview.nextExpandedLibraryId(null, result), null);
  assert.equal(preview.libraryPlayerState(result, "moment-1", "rippo-media://local/file"), "closed");
});

test("library player state covers loading missing video audio and image paths", () => {
  assert.equal(preview.libraryPlayerState({ id: "video", kind: "video" }, "video", undefined), "loading");
  assert.equal(preview.libraryPlayerState({ id: "video", kind: "video" }, "video", null), "missing");
  assert.equal(preview.libraryPlayerState({ id: "video", kind: "video" }, "video", "rippo-media://local/video"), "video");
  assert.equal(preview.libraryPlayerState({ id: "audio", kind: "audio" }, "audio", "rippo-media://local/audio"), "audio");
  assert.equal(preview.libraryPlayerState({ id: "image", kind: "image" }, "image", "rippo-media://local/image"), "image");
});

test("library preview start clamps empty or negative moment starts to the full-file start", () => {
  assert.equal(preview.libraryPreviewStart({ start: 12.5 }), 12.5);
  assert.equal(preview.libraryPreviewStart({ start: 0 }), 0);
  assert.equal(preview.libraryPreviewStart({ start: -3 }), 0);
  assert.equal(preview.libraryPreviewStart({ start: null }), 0);
  assert.equal(preview.libraryPreviewStart({}), 0);
});
