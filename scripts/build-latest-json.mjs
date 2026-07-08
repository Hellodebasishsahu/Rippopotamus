// Assembles the tauri-plugin-updater `latest.json` manifest from the signed
// updater artifacts produced by `tauri build` (with `createUpdaterArtifacts`
// on) on each platform runner. Run once, after both the macOS and Windows
// package jobs have uploaded their `.sig` files, right before publishing the
// GitHub release.
//
// Usage:
//   node scripts/build-latest-json.mjs \
//     --version 0.2.0 \
//     --notes-file CHANGELOG-latest.md \
//     --repo Hellodebasishsahu/Rippopotamus \
//     --tag v0.2.0 \
//     --mac-sig release/updater/Rippopotamus.app.tar.gz.sig \
//     --mac-asset Rippopotamus.app.tar.gz \
//     --win-sig release/updater/Rippopotamus_x64-setup.nsis.zip.sig \
//     --win-asset Rippopotamus_x64-setup.nsis.zip \
//     --out release/updater/latest.json
import fs from "node:fs";

function arg(name, required = true) {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (required && !value) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return value;
}

const version = arg("version");
const notesFile = arg("notes-file", false);
const repo = arg("repo");
const tag = arg("tag");
const macSigPath = arg("mac-sig", false);
const macAsset = arg("mac-asset", false);
const winSigPath = arg("win-sig", false);
const winAsset = arg("win-asset", false);
const out = arg("out");

if (!macSigPath && !winSigPath) {
  console.error("Need at least one of --mac-sig or --win-sig");
  process.exit(1);
}

const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8").trim() : `Rippopotamus ${version}`;
const downloadBase = `https://github.com/${repo}/releases/download/${tag}`;

const platforms = {};
if (macSigPath) {
  platforms["darwin-aarch64"] = {
    signature: fs.readFileSync(macSigPath, "utf8").trim(),
    url: `${downloadBase}/${macAsset}`,
  };
}
if (winSigPath) {
  platforms["windows-x86_64"] = {
    signature: fs.readFileSync(winSigPath, "utf8").trim(),
    url: `${downloadBase}/${winAsset}`,
  };
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${out}`);
