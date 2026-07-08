import fs from "node:fs";
import path from "node:path";

const [platform] = process.argv.slice(2);

if (!platform) {
  console.error("Usage: node scripts/install-aria2c-resource.mjs <darwin|win32|linux>");
  process.exit(1);
}

const executable = platform === "win32" ? "aria2c.exe" : "aria2c";
const target = path.join(process.cwd(), "build", "bin", executable);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function commandPath(command) {
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, command);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function sourcePath() {
  const configured = process.env.RIPPO_ARIA2C_SOURCE?.trim() || process.env.RIPPO_ARIA2C_PATH?.trim();
  if (configured) return configured;
  if (platform === process.platform) return commandPath(executable);
  return null;
}

function prefix(filePath, length) {
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, 0);
    return buffer;
  } finally {
    fs.closeSync(handle);
  }
}

function assertPlatformBinary(filePath) {
  const magic = prefix(filePath, 4);
  if (platform === "win32") {
    if (magic.subarray(0, 2).toString("ascii") !== "MZ") {
      fail(`aria2c source is not a Windows executable: ${filePath}`);
    }
    return;
  }
  if (platform === "darwin") {
    const accepted = [
      Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
      Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
      Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
      Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
      Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
      Buffer.from([0xca, 0xfe, 0xba, 0xbf]),
    ];
    if (!accepted.some((candidate) => magic.equals(candidate))) {
      fail(`aria2c source is not a macOS executable: ${filePath}`);
    }
    return;
  }
  if (platform === "linux" && magic.toString("ascii", 0, 4) !== "\x7fELF") {
    fail(`aria2c source is not a Linux executable: ${filePath}`);
  }
}

const source = sourcePath();
if (!source) {
  fail(`Missing aria2c for ${platform}. Set RIPPO_ARIA2C_SOURCE to a ${platform} aria2c binary.`);
}
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
  fail(`aria2c source is not a file: ${source}`);
}

assertPlatformBinary(source);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
if (platform !== "win32") fs.chmodSync(target, 0o755);

console.log(`Prepared aria2c ${platform} resource: ${target}`);
