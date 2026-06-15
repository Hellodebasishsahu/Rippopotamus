import { ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  appManagedGalleryDlRoot,
  appManagedYtDlpPath,
} from "./appPaths";
import { runEngine, runPython } from "./engineProcess";

type YtDlpReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type YtDlpRelease = {
  tag_name: string;
  assets: YtDlpReleaseAsset[];
};

type YtDlpUpdateInfo = {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  binaryPath: string;
  managedBinaryExists: boolean;
  downloadUrl?: string;
  error?: string;
};

type PyPiPackageInfo = {
  info: {
    version: string;
  };
};

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^v/i, "") || null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left)?.split(/[.-]/).map((part) => Number(part)) || [];
  const rightParts = normalizeVersion(right)?.split(/[.-]/).map((part) => Number(part)) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const b = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function ytDlpAssetName(): string {
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "linux" && process.arch === "arm64") return "yt-dlp_linux_aarch64";
  return "yt-dlp_linux";
}

async function fetchLatestYtDlpRelease(): Promise<YtDlpRelease> {
  const response = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`GitHub release check failed: ${response.status}`);
  return await response.json() as YtDlpRelease;
}

function selectYtDlpAsset(release: YtDlpRelease): YtDlpReleaseAsset {
  const expected = ytDlpAssetName();
  const asset = release.assets.find((candidate) => candidate.name === expected);
  if (!asset) throw new Error(`No yt-dlp release asset found for ${process.platform}/${process.arch}.`);
  return asset;
}

async function currentYtDlpVersion(): Promise<string | null> {
  try {
    const health = await runEngine(["health"]) as { ytDlp?: string };
    return normalizeVersion(health.ytDlp);
  } catch {
    return null;
  }
}

async function checkYtDlpUpdate(): Promise<YtDlpUpdateInfo> {
  const binaryPath = appManagedYtDlpPath();
  const [release, currentVersion] = await Promise.all([
    fetchLatestYtDlpRelease(),
    currentYtDlpVersion(),
  ]);
  const latestVersion = normalizeVersion(release.tag_name);
  const asset = selectYtDlpAsset(release);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion && (!currentVersion || compareVersions(latestVersion, currentVersion) > 0)),
    binaryPath,
    managedBinaryExists: fs.existsSync(binaryPath),
    downloadUrl: asset.browser_download_url,
  };
}

async function fetchLatestGalleryDlPackage(): Promise<PyPiPackageInfo> {
  const response = await fetch("https://pypi.org/pypi/gallery-dl/json", {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`gallery-dl release check failed: ${response.status}`);
  return await response.json() as PyPiPackageInfo;
}

async function currentGalleryDlVersion(): Promise<string | null> {
  try {
    const health = await runEngine(["health"]) as { galleryDl?: string | null };
    return normalizeVersion(health.galleryDl);
  } catch {
    return null;
  }
}

async function checkGalleryDlUpdate(): Promise<YtDlpUpdateInfo> {
  const binaryPath = appManagedGalleryDlRoot();
  const [latest, currentVersion] = await Promise.all([
    fetchLatestGalleryDlPackage(),
    currentGalleryDlVersion(),
  ]);
  const latestVersion = normalizeVersion(latest.info.version);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion && (!currentVersion || compareVersions(latestVersion, currentVersion) > 0)),
    binaryPath,
    managedBinaryExists: fs.existsSync(binaryPath),
    downloadUrl: latestVersion ? `gallery-dl==${latestVersion}` : undefined,
  };
}

async function installYtDlpUpdate(downloadUrl: string): Promise<void> {
  const binaryPath = appManagedYtDlpPath();
  const binDir = path.dirname(binaryPath);
  const tmpPath = path.join(binDir, `${path.basename(binaryPath)}.${process.pid}.tmp`);
  fs.mkdirSync(binDir, { recursive: true });

  const response = await fetch(downloadUrl, {
    headers: {
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`yt-dlp download failed: ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tmpPath, bytes, { mode: 0o755 });
  if (process.platform !== "win32") fs.chmodSync(tmpPath, 0o755);
  fs.renameSync(tmpPath, binaryPath);
}

async function installGalleryDlUpdate(version: string): Promise<void> {
  const target = appManagedGalleryDlRoot();
  const tmpTarget = path.join(path.dirname(target), `gallery-dl.${process.pid}.tmp`);
  fs.rmSync(tmpTarget, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });

  await runPython([
    "-m",
    "pip",
    "install",
    "--upgrade",
    "--no-input",
    "--disable-pip-version-check",
    "--target",
    tmpTarget,
    `gallery-dl==${version}`,
  ]);

  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmpTarget, target);
}

export function registerToolUpdateIpcHandlers(engineHealthPayload: () => Promise<Record<string, unknown>>) {
  ipcMain.handle("ytdlp:check-update", async () => {
    return checkYtDlpUpdate();
  });

  ipcMain.handle("ytdlp:update", async () => {
    const update = await checkYtDlpUpdate();
    if (!update.downloadUrl) throw new Error("No yt-dlp download URL is available.");
    await installYtDlpUpdate(update.downloadUrl);
    const health = await engineHealthPayload();
    return {
      ...(await checkYtDlpUpdate()),
      health,
    };
  });

  ipcMain.handle("gallerydl:check-update", async () => {
    return checkGalleryDlUpdate();
  });

  ipcMain.handle("gallerydl:update", async () => {
    const update = await checkGalleryDlUpdate();
    if (!update.latestVersion) throw new Error("No gallery-dl version is available.");
    await installGalleryDlUpdate(update.latestVersion);
    const health = await engineHealthPayload();
    return {
      ...(await checkGalleryDlUpdate()),
      health,
    };
  });
}
