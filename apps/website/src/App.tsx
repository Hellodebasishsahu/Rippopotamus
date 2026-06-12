const macDownloadUrl = "/downloads/Rippopotamus-0.1.0-arm64.dmg";

const featureIcons = {
  clipboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" />
      <path d="M9 10h6" />
      <path d="M9 14h4" />
    </svg>
  ),
  sliders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h16" />
      <circle cx="8" cy="8" r="2" />
      <path d="M4 16h16" />
      <circle cx="16" cy="16" r="2" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M3 10h18" />
    </svg>
  ),
  unlock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="11" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7-2" />
      <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
} as const;

const features = [
  {
    title: "Paste anything",
    body: "One URL or a whole list. Rippo fetches metadata and thumbnails before you commit disk space.",
    icon: featureIcons.clipboard,
    variant: "hero",
    accent: "coral",
  },
  {
    title: "Pick your format",
    body: "Resolution, container, audio-only — choose per item or set a default and move on.",
    icon: featureIcons.sliders,
    variant: "compact",
    accent: "mint",
  },
  {
    title: "Save locally",
    body: "Files land in your folder. No cloud hop, no vendor vault, no export unlock.",
    icon: featureIcons.folder,
    variant: "compact",
    accent: "mint",
  },
  {
    title: "Stay free",
    body: "Open source, no account, no subscription. The engines are yours — Rippo just runs them.",
    icon: featureIcons.unlock,
    variant: "banner",
    accent: "coral",
  },
] as const;

export function App() {
  return (
    <div className="page">
      <div className="grain" aria-hidden="true" />
      <div className="glow glow-a" aria-hidden="true" />
      <div className="glow glow-b" aria-hidden="true" />

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="kicker">Open source downloader · macOS</p>
              <h1 id="hero-title">
                <span className="line">Paste.</span>
                <span className="line">Pick.</span>
                <span className="line accent">Save.</span>
              </h1>
              <p className="lede">
                The downloader you were about to subscribe to — except it&apos;s free,
                runs on your machine, and never phones home.
              </p>
              <div className="hero-cta" id="download">
                <a className="btn-main" href={macDownloadUrl} download>
                  <span>Get Rippo for Mac</span>
                  <small>Apple Silicon · DMG · 0$/mo</small>
                </a>
              </div>
            </div>

            <div className="hero-brand" aria-hidden="true">
              <div className="logo-glow" />
              <img
                className="logo-mark"
                src="/brand-logo.png"
                alt=""
                width={360}
                height={360}
                decoding="async"
              />
            </div>
          </div>
        </section>

        <section className="features" id="features" aria-labelledby="features-title">
          <div className="features-head">
            <p className="kicker">Features</p>
            <h2 id="features-title">Built to download. Nothing else.</h2>
            <p className="features-lede">
              A focused downloader — batch queues, full format control, local files, zero subscription.
            </p>
          </div>

          <div className="bento-grid">
            {features.map((f) => (
              <article
                key={f.title}
                className={`bento-card bento-card--${f.variant} bento-card--${f.accent}`}
              >
                <div className="bento-accent" aria-hidden="true" />
                <span className="bento-icon">{f.icon}</span>
                <h3 className="bento-title">{f.title}</h3>
                <p className="bento-body">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="manifesto" aria-labelledby="manifesto-title">
          <blockquote id="manifesto-title">
            Paid downloaders rent you the same engines you can run yourself.
            <em> Rippo just gets out of the way.</em>
          </blockquote>
        </section>
      </main>

      <footer className="foot">
        <img className="foot-logo" src="/brand-logo.png" alt="" width={28} height={28} />
        <span>© {new Date().getFullYear()} Rippo</span>
      </footer>
    </div>
  );
}