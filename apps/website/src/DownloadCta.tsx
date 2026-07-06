import { useEffect, useState } from "react";
import { MarqueeIcon } from "./MarqueeIcons";
import { detectPlatform, getDownloadCta, RELEASES_LATEST_API } from "./platform";

export function DownloadCta() {
  const [cta, setCta] = useState(() => getDownloadCta(detectPlatform()));

  useEffect(() => {
    if (!cta.available) return;
    // Upgrade the release-page link to the direct .dmg asset from the latest release.
    fetch(RELEASES_LATEST_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((release) => {
        const asset = release?.assets?.find((candidate: { name?: string; browser_download_url?: string }) =>
          candidate.name?.toLowerCase().endsWith(".dmg"),
        );
        if (asset?.browser_download_url) setCta((current) => ({ ...current, href: asset.browser_download_url }));
      })
      .catch(() => {
        // Release page baseline still works without the upgrade.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const className = [
    "btn-main",
    !cta.available ? "btn-main--soon" : "",
    cta.hint ? "btn-main--stacked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="hero-cta" id="download">
      <a
        className={className}
        href={cta.href}
        {...(cta.download ? { download: true } : {})}
        {...(!cta.available ? { "aria-disabled": "true" } : {})}
      >
        <span className="btn-main-title">
          {cta.label}
          <MarqueeIcon icon={cta.icon} size={18} />
        </span>
        {cta.hint ? <small>{cta.hint}</small> : null}
      </a>
    </div>
  );
}
