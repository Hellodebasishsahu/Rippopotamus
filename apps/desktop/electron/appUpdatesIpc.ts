import { app, ipcMain } from "electron";

const GITHUB_RELEASES_LATEST = "https://api.github.com/repos/Hellodebasishsahu/Rippopotamus/releases/latest";

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubRelease = {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
};

type AppUpdateManifest = {
  version?: string;
  date?: string;
  dmgUrl?: string;
  notes?: string[];
};

type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  configured: boolean;
  manifestUrl: string | null;
  dmgUrl: string | null;
  date?: string;
  notes: string[];
  error?: string;
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

function configuredManifestUrl(): string | null {
  const raw = (process.env.RIPPO_APP_UPDATE_MANIFEST_URL || "").trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("App update manifest must be an http or https URL.");
  }
  return parsed.toString();
}

function validateDmgUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

async function checkAppUpdate(): Promise<AppUpdateInfo> {
  const currentVersion = app.getVersion();
  let manifestUrl: string | null = null;
  try {
    manifestUrl = configuredManifestUrl();
  } catch (error) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      configured: true,
      manifestUrl: null,
      dmgUrl: null,
      notes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Default channel: latest GitHub release. The env manifest above is a dev override.
  if (!manifestUrl) {
    try {
      const response = await fetch(GITHUB_RELEASES_LATEST, {
        headers: {
          "Accept": "application/vnd.github+json",
          "User-Agent": "Rippopotamus",
        },
      });
      if (response.status === 404) {
        // No releases published yet — report current version as latest.
        return {
          currentVersion,
          latestVersion: null,
          updateAvailable: false,
          configured: true,
          manifestUrl: GITHUB_RELEASES_LATEST,
          dmgUrl: null,
          notes: [],
        };
      }
      if (!response.ok) throw new Error(`App update check failed: ${response.status}`);

      const release = await response.json() as GitHubRelease;
      const latestVersion = normalizeVersion(release.tag_name);
      const assetName = process.platform === "win32" ? ".exe" : ".dmg";
      const asset = (release.assets || []).find((candidate) => candidate.name?.toLowerCase().endsWith(assetName));
      // Fall back to the release page so users without a platform asset can still get the update.
      const dmgUrl = validateDmgUrl(asset?.browser_download_url) || validateDmgUrl(release.html_url);
      return {
        currentVersion,
        latestVersion,
        updateAvailable: Boolean(latestVersion && dmgUrl && compareVersions(latestVersion, currentVersion) > 0),
        configured: true,
        manifestUrl: GITHUB_RELEASES_LATEST,
        dmgUrl,
        date: typeof release.published_at === "string" ? release.published_at.slice(0, 10) : undefined,
        notes: typeof release.body === "string"
          ? release.body.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 10)
          : [],
      };
    } catch (error) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        configured: true,
        manifestUrl: GITHUB_RELEASES_LATEST,
        dmgUrl: null,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    const response = await fetch(manifestUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Rippopotamus",
      },
    });
    if (!response.ok) throw new Error(`App update check failed: ${response.status}`);

    const manifest = await response.json() as AppUpdateManifest;
    const latestVersion = normalizeVersion(manifest.version);
    const dmgUrl = validateDmgUrl(manifest.dmgUrl);
    return {
      currentVersion,
      latestVersion,
      updateAvailable: Boolean(latestVersion && dmgUrl && compareVersions(latestVersion, currentVersion) > 0),
      configured: true,
      manifestUrl,
      dmgUrl,
      date: typeof manifest.date === "string" ? manifest.date : undefined,
      notes: Array.isArray(manifest.notes) ? manifest.notes.filter((note): note is string => typeof note === "string") : [],
    };
  } catch (error) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      configured: true,
      manifestUrl,
      dmgUrl: null,
      notes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerAppUpdateIpcHandlers() {
  ipcMain.handle("app-update:check", async () => {
    return checkAppUpdate();
  });
}
