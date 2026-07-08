import { useState } from "react";
import { MarqueeIcon } from "./MarqueeIcons";
import { detectPlatform, getDownloadCta } from "./platform";

export function DownloadCta() {
  // Static, stable CTA — no runtime API call needed.
  const [cta] = useState(() => getDownloadCta(detectPlatform()));
  const [copied, setCopied] = useState(false);

  // Platforms with a one-line installer (mac/windows): show the command.
  if (cta.command) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(cta.command!);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        setCopied(false);
      }
    };

    return (
      <div className="hero-cta" id="download">
        <div className="install-head">
          <MarqueeIcon icon={cta.icon} size={18} />
          <span>{cta.label} — paste this in your terminal</span>
        </div>
        <div className="install-cmd">
          <code>{cta.command}</code>
          <button type="button" onClick={copy} aria-label="Copy install command">
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <a className="install-alt" href={cta.href} {...(cta.download ? { download: true } : {})}>
          or {cta.altLabel}
        </a>
      </div>
    );
  }

  // Fallback (linux / mobile / coming-soon): the old button.
  const className = ["btn-main", !cta.available ? "btn-main--soon" : "", cta.hint ? "btn-main--stacked" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="hero-cta" id="download">
      <a className={className} href={cta.href} {...(!cta.available ? { "aria-disabled": "true" } : {})}>
        <span className="btn-main-title">
          {cta.label}
          <MarqueeIcon icon={cta.icon} size={18} />
        </span>
        {cta.hint ? <small>{cta.hint}</small> : null}
      </a>
    </div>
  );
}
