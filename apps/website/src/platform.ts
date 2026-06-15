import type { IconDef } from "./MarqueeIcons";
import { appleIcon, linuxIcon, windowsIcon } from "./MarqueeIcons";

export const APP_VERSION = "0.1.0";

export type OsPlatform = "mac" | "windows" | "linux" | "ios" | "android" | "unknown";

export type DownloadCta = {
  label: string;
  href: string;
  icon: IconDef;
  available: boolean;
  download?: boolean;
  hint?: string;
};

const downloads = {
  mac: `/downloads/Rippopotamus-${APP_VERSION}-arm64.dmg`,
  // Set when a Windows installer is hosted under public/downloads/.
  windows: null as string | null,
} as const;

export function detectPlatform(): OsPlatform {
  if (typeof navigator === "undefined") return "unknown";

  const ua = navigator.userAgent;
  const legacyPlatform = navigator.platform?.toLowerCase() ?? "";
  const uaData = navigator.userAgentData;

  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";

  const hintedPlatform = uaData?.platform?.toLowerCase();
  if (hintedPlatform === "macos") return "mac";
  if (hintedPlatform === "windows") return "windows";
  if (hintedPlatform === "linux" || hintedPlatform === "chrome os") return "linux";

  if (/Mac|Macintosh/i.test(ua) || legacyPlatform.includes("mac")) return "mac";
  if (/Win/i.test(legacyPlatform) || /Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(legacyPlatform) || /X11/i.test(ua)) return "linux";

  return "unknown";
}

function macCta(): DownloadCta {
  return {
    label: "Download for Mac",
    href: downloads.mac,
    icon: appleIcon,
    available: true,
    download: true,
  };
}

export function getDownloadCta(platform: OsPlatform = detectPlatform()): DownloadCta {
  switch (platform) {
    case "mac":
      return macCta();

    case "windows":
      if (downloads.windows) {
        return {
          label: "Download for Windows",
          href: downloads.windows,
          icon: windowsIcon,
          available: true,
          download: true,
        };
      }
      return {
        label: "Windows coming soon",
        href: "#windows",
        icon: windowsIcon,
        available: false,
        hint: "Signed Windows builds are on the way.",
      };

    case "linux":
      return {
        label: "Linux coming soon",
        href: "#platforms",
        icon: linuxIcon,
        available: false,
        hint: "Mac is available now while we finish desktop packaging.",
      };

    case "ios":
    case "android":
      return {
        ...macCta(),
        available: false,
        href: "#",
        download: false,
        hint: "Rippo is a desktop app. Open this page on your Mac to install.",
      };

    case "unknown":
    default:
      return macCta();
  }
}
