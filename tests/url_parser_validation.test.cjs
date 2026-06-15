const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

function loadParser() {
  const sourcePath = path.join(__dirname, "..", "apps", "desktop", "src", "urlParser.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    URL,
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: sourcePath });
  return sandbox.module.exports;
}

const { extractUrls, normalizeUrlCandidate } = loadParser();

test("extractUrls preserves YouTube query strings", () => {
  assert.deepEqual(
    Array.from(extractUrls("https://www.youtube.com/watch?v=TQd2k1pEXp4")),
    ["https://www.youtube.com/watch?v=TQd2k1pEXp4"],
  );
});

test("normalizeUrlCandidate preserves exact YouTube video URL", () => {
  assert.equal(
    normalizeUrlCandidate("https://www.youtube.com/watch?v=TQd2k1pEXp4"),
    "https://www.youtube.com/watch?v=TQd2k1pEXp4",
  );
});

test("extractUrls accepts explicit URLs with uncommon valid TLDs", () => {
  assert.deepEqual(
    Array.from(extractUrls("https://youtu.be/TQd2k1pEXp4")),
    ["https://youtu.be/TQd2k1pEXp4"],
  );
});

test("extractUrls accepts real pasted bare links on uncommon domains when they include a path", () => {
  assert.deepEqual(
    Array.from(extractUrls("xhamster.desi/search/indian+cuckold+threesome")),
    ["https://xhamster.desi/search/indian+cuckold+threesome"],
  );
});

test("extractUrls accepts escaped JSON urls and html entities", () => {
  assert.deepEqual(
    Array.from(extractUrls('{"pageURL":"https:\\/\\/example.desi\\/videos\\/demo?x=1\\u0026y=2"}')),
    ["https://example.desi/videos/demo?x=1&y=2"],
  );
});

test("extractUrls accepts protocol relative links", () => {
  assert.deepEqual(
    Array.from(extractUrls("//cdn.example.com/video.mp4")),
    ["https://cdn.example.com/video.mp4"],
  );
});

test("extractUrls handles markdown links and trailing punctuation", () => {
  assert.deepEqual(
    Array.from(extractUrls("watch [this](https://www.youtube.com/watch?v=TQd2k1pEXp4), then https://commons.wikimedia.org/wiki/File:Example.jpg.")),
    [
      "https://www.youtube.com/watch?v=TQd2k1pEXp4",
      "https://commons.wikimedia.org/wiki/File:Example.jpg",
    ],
  );
});

test("extractUrls handles bare domains and deduplicates", () => {
  assert.deepEqual(
    Array.from(extractUrls("youtube.com/watch?v=TQd2k1pEXp4 https://youtube.com/watch?v=TQd2k1pEXp4")),
    ["https://youtube.com/watch?v=TQd2k1pEXp4"],
  );
});

test("extractUrls ignores email addresses and plain words", () => {
  assert.deepEqual(Array.from(extractUrls("send to name@example.com and then fetch later")), []);
});

test("extractUrls ignores protocol URLs sandwiched inside words", () => {
  assert.deepEqual(
    Array.from(extractUrls("lettucehttps://www.youtube.com/watch?v=TQd2k1pEXp4")),
    [],
  );
});

test("extractUrls ignores bare dotted gibberish", () => {
  assert.deepEqual(
    Array.from(extractUrls("this is just.lettuice not a link")),
    [],
  );
});

test("extractUrls still accepts supported bare domains after punctuation", () => {
  assert.deepEqual(
    Array.from(extractUrls("(youtube.com/watch?v=TQd2k1pEXp4)")),
    ["https://youtube.com/watch?v=TQd2k1pEXp4"],
  );
});

test("extractUrls accepts magnet links", () => {
  assert.deepEqual(
    Array.from(extractUrls("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example")),
    ["magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example"],
  );
});

test("extractUrls accepts torrent URLs", () => {
  assert.deepEqual(
    Array.from(extractUrls("https://example.com/file.torrent")),
    ["https://example.com/file.torrent"],
  );
});

test("normalizeUrlCandidate rejects non-web protocols", () => {
  assert.equal(normalizeUrlCandidate("file:///tmp/a.png"), null);
});
