import { ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  appManagedGalleryDlRoot,
  appManagedYtDlpPath,
} from "./appPaths";
import { runPython } from "./engineProcess";
import { normalizeVersion, compareVersions } from "./versionUtils";

export type HelperCheckResult = {
  name: string;
  currentVersion: string | null;
  latestVersion: string | null;
  updatable: boolean;
  updateAvailable: boolean;
  error?: string;
};

export type HelperUpdateResult = {
  name: string;
  from: string | null;
  to: string | null;
  ok: boolean;
  error?: string;
};

type YtDlpReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type YtDlpRelease = {
  tag_name: string;
  assets: YtDlpReleaseAsset[];
};

type PyPiPackageInfo = {
  info: {
    version: string;
  };
};

type LatestInfo = {
  latestVersion: string | null;
  installArg?: string;
};

type HelperDescriptor = {
  name: string;
  updatable: boolean;
  readCurrentVersion: (health: Record<string, unknown>) => string | null;
  fetchLatest?: () => Promise<LatestInfo>;
  install?: (installArg: string) => Promise<void>;
};

function ytDlpAssetName(): string {
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "linux" && process.arch === "arm64") return "yt-dlp_linux_aarch64";
  return "yt-dlp_linux";
}

async function fetchLatestYtDlp(): Promise<LatestInfo> {
  const response = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`GitHub release check failed: ${response.status}`);
  const release = await response.json() as YtDlpRelease;
  const latestVersion = normalizeVersion(release.tag_name);
  const expected = ytDlpAssetName();
  const asset = release.assets.find((candidate) => candidate.name === expected);
  if (!asset) throw new Error(`No yt-dlp release asset found for ${process.platform}/${process.arch}.`);
  return { latestVersion, installArg: asset.browser_download_url };
}

async function installYtDlp(downloadUrl: string): Promise<void> {
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

async function fetchLatestGalleryDl(): Promise<LatestInfo> {
  const response = await fetch("https://pypi.org/pypi/gallery-dl/json", {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Rippopotamus",
    },
  });
  if (!response.ok) throw new Error(`gallery-dl release check failed: ${response.status}`);
  const latest = await response.json() as PyPiPackageInfo;
  const latestVersion = normalizeVersion(latest.info.version);
  return { latestVersion, installArg: latestVersion || undefined };
}

async function installGalleryDl(version: string): Promise<void> {
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

const HELPER_DESCRIPTORS: HelperDescriptor[] = [
  {
    name: "yt-dlp",
    updatable: true,
    readCurrentVersion: (health) => normalizeVersion(health.ytDlp as string | undefined),
    fetchLatest: fetchLatestYtDlp,
    install: installYtDlp,
  },
  {
    name: "gallery-dl",
    updatable: true,
    readCurrentVersion: (health) => normalizeVersion(health.galleryDl as string | null | undefined),
    fetchLatest: fetchLatestGalleryDl,
    install: installGalleryDl,
  },
  {
    name: "aria2c",
    updatable: false,
    readCurrentVersion: (health) => (health.aria2c as string | null | undefined) || null,
  },
  {
    name: "ffmpeg",
    updatable: false,
    readCurrentVersion: (health) => (health.ffmpegVersion as string | null | undefined) || null,
  },
];

export async function checkAllHelpers(
  engineHealthPayload: () => Promise<Record<string, unknown>>,
): Promise<HelperCheckResult[]> {
  const health = await engineHealthPayload();
  return Promise.all(HELPER_DESCRIPTORS.map(async (descriptor): Promise<HelperCheckResult> => {
    const currentVersion = descriptor.readCurrentVersion(health);
    if (!descriptor.updatable || !descriptor.fetchLatest) {
      return {
        name: descriptor.name,
        currentVersion,
        latestVersion: null,
        updatable: false,
        updateAvailable: false,
      };
    }
    try {
      const { latestVersion } = await descriptor.fetchLatest();
      return {
        name: descriptor.name,
        currentVersion,
        latestVersion,
        updatable: true,
        updateAvailable: Boolean(latestVersion && (!currentVersion || compareVersions(latestVersion, currentVersion) > 0)),
      };
    } catch (error) {
      return {
        name: descriptor.name,
        currentVersion,
        latestVersion: null,
        updatable: true,
        updateAvailable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

export async function updateAllHelpers(
  engineHealthPayload: () => Promise<Record<string, unknown>>,
): Promise<HelperUpdateResult[]> {
  const health = await engineHealthPayload();
  const results: HelperUpdateResult[] = [];

  for (const descriptor of HELPER_DESCRIPTORS) {
    if (!descriptor.updatable || !descriptor.fetchLatest || !descriptor.install) continue;
    const from = descriptor.readCurrentVersion(health);
    try {
      const { latestVersion, installArg } = await descriptor.fetchLatest();
      const updateAvailable = Boolean(latestVersion && installArg && (!from || compareVersions(latestVersion, from) > 0));
      if (!updateAvailable || !installArg) continue;
      await descriptor.install(installArg);
      results.push({ name: descriptor.name, from, to: latestVersion, ok: true });
    } catch (error) {
      results.push({
        name: descriptor.name,
        from,
        to: null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function registerHelperIpcHandlers(engineHealthPayload: () => Promise<Record<string, unknown>>) {
  ipcMain.handle("helpers:check-all", async () => {
    return checkAllHelpers(engineHealthPayload);
  });

  ipcMain.handle("helpers:update-all", async () => {
    return updateAllHelpers(engineHealthPayload);
  });
}
