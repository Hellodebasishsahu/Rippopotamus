const fs = require("node:fs");
const path = require("node:path");

function removeIfExists(filePath) {
  fs.rmSync(filePath, { force: true });
}

function packagedResourcesPath(context) {
  if (context.electronPlatformName === "darwin") {
    const productFilename = context.packager.appInfo.productFilename;
    return path.join(context.appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return path.join(context.appOutDir, "resources");
}

function pruneCompiledPython(root) {
  if (!fs.existsSync(root)) return;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") {
        fs.rmSync(entryPath, { recursive: true, force: true });
        continue;
      }
      pruneCompiledPython(entryPath);
    } else if (entry.isFile() && (entry.name.endsWith(".pyc") || entry.name.endsWith(".pyo"))) {
      removeIfExists(entryPath);
    }
  }
}

exports.default = async function afterPack(context) {
  pruneCompiledPython(path.join(packagedResourcesPath(context), "engine"));

  const ffmpegRoot = path.join(
    packagedResourcesPath(context),
    "app.asar.unpacked",
    "node_modules",
    "ffmpeg-static",
  );

  if (!fs.existsSync(ffmpegRoot)) return;

  if (context.electronPlatformName === "win32") {
    const target = path.join(ffmpegRoot, "ffmpeg.exe");
    if (!fs.existsSync(target)) {
      throw new Error(`Windows package is missing bundled ffmpeg.exe at ${target}`);
    }
    removeIfExists(path.join(ffmpegRoot, "ffmpeg"));
    removeIfExists(path.join(ffmpegRoot, "ffmpeg.README"));
    removeIfExists(path.join(ffmpegRoot, "ffmpeg.LICENSE"));
    return;
  }

  const target = path.join(ffmpegRoot, "ffmpeg");
  if (!fs.existsSync(target)) {
    throw new Error(`${context.electronPlatformName} package is missing bundled ffmpeg at ${target}`);
  }
  removeIfExists(path.join(ffmpegRoot, "ffmpeg.exe"));
  removeIfExists(path.join(ffmpegRoot, "ffmpeg.exe.README"));
  removeIfExists(path.join(ffmpegRoot, "ffmpeg.exe.LICENSE"));
};
