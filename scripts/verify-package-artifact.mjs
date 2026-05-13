import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
const root = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertFile(filePath, label) {
  const absolute = path.join(root, filePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    fail(`Missing ${label}: ${filePath}`);
  }
  return absolute;
}

function assertDir(dirPath, label) {
  const absolute = path.join(root, dirPath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    fail(`Missing ${label}: ${dirPath}`);
  }
}

function readPrefix(filePath, length) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

if (target === "win") {
  const appExe = assertFile("release/win-unpacked/Rippopotamus.exe", "Windows app executable");
  assertFile("release/win-unpacked/resources/app.asar", "Windows app asar");
  assertDir("release/win-unpacked/resources/app.asar.unpacked", "Windows unpacked resources");
  const ffmpegExe = assertFile("release/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe", "Windows ffmpeg.exe");
  if (fs.existsSync(path.join(root, "release/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg"))) {
    fail("Windows package must not include the macOS/Linux ffmpeg binary.");
  }
  for (const file of [appExe, ffmpegExe]) {
    if (readPrefix(file, 2).toString("ascii") !== "MZ") {
      fail(`Expected PE executable header in ${path.relative(root, file)}`);
    }
  }
  console.log("Windows package artifact shape is valid.");
} else if (target === "mac") {
  const appBinary = assertFile("release/mac-arm64/Rippopotamus.app/Contents/MacOS/Rippopotamus", "macOS app executable");
  assertFile("release/mac-arm64/Rippopotamus.app/Contents/Resources/app.asar", "macOS app asar");
  assertDir("release/mac-arm64/Rippopotamus.app/Contents/Resources/app.asar.unpacked", "macOS unpacked resources");
  const ffmpeg = assertFile("release/mac-arm64/Rippopotamus.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg", "macOS ffmpeg");
  if (fs.existsSync(path.join(root, "release/mac-arm64/Rippopotamus.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe"))) {
    fail("macOS package must not include the Windows ffmpeg.exe binary.");
  }
  for (const file of [appBinary, ffmpeg]) {
    const magic = readPrefix(file, 4);
    if (!magic.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) && !magic.equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))) {
      fail(`Expected Mach-O executable header in ${path.relative(root, file)}`);
    }
  }
  console.log("macOS package artifact shape is valid.");
} else {
  fail("Usage: node scripts/verify-package-artifact.mjs <mac|win>");
}
