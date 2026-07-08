import type { CSSProperties } from "react";
import { marqueeIcons, MarqueeIcon, type MarqueeBrand } from "./MarqueeIcons";
import { useMediaQuery } from "./useMediaQuery";

const HALO_ICON_NAMES: MarqueeBrand[] = [
  "youtube",
  "instagram",
  "tiktok",
  "twitch",
  "spotify",
  "reddit",
  "vimeo",
  "soundcloud",
];

const haloIcons = HALO_ICON_NAMES.map((name) => marqueeIcons.find((entry) => entry.name === name)!);

export function HeroIconHalo() {
  const isMobile = useMediaQuery("(max-width: 900px)");
  if (!isMobile) return null;

  return (
    <div className="hero-halo" aria-hidden="true">
      <div className="hero-halo-glow" />
      <div className="hero-halo-ring">
        {haloIcons.map(({ icon, name }, index) => {
          const arcStart = -75;
          const arcEnd = 75;
          const angle = arcStart + ((arcEnd - arcStart) / (haloIcons.length - 1)) * index;

          return (
            <div
              key={name}
              className="hero-halo-spoke"
              style={{ "--halo-angle": `${angle}deg` } as CSSProperties}
            >
              <div className={`hero-halo-icon ${name}`}>
                <MarqueeIcon icon={icon} size={18} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
