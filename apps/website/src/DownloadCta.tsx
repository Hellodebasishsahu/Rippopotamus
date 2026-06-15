import { useState } from "react";
import { MarqueeIcon } from "./MarqueeIcons";
import { detectPlatform, getDownloadCta } from "./platform";

export function DownloadCta() {
  const [cta] = useState(() => getDownloadCta(detectPlatform()));

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
