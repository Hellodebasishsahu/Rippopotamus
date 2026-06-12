const macDownloadUrl = "/downloads/Rippopotamus-0.1.0-arm64.dmg";

const features = [
  {
    n: "01",
    step: "paste",
    title: "Paste anything",
    body: "One URL or a whole list. Rippo fetches metadata and thumbnails before you commit disk space.",
  },
  {
    n: "02",
    step: "pick",
    title: "Pick your format",
    body: "Resolution, container, audio-only — choose per item or set a default and move on.",
  },
  {
    n: "03",
    step: "save",
    title: "Save locally",
    body: "Files land in your folder. No cloud hop, no vendor vault, no export unlock.",
  },
  {
    n: "04",
    step: "free",
    title: "Stay free",
    body: "Open source, no account, no subscription. The engines are yours — Rippo just runs them.",
  },
];

function WorkflowIcon({ step }: { step: string }) {
  switch (step) {
    case "paste":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="7" y="4" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 8h6M9 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M10 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "pick":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="7" r="2" fill="currentColor" />
          <path d="M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="15" cy="12" r="2" fill="currentColor" />
          <path d="M5 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="11" cy="17" r="2" fill="currentColor" />
        </svg>
      );
    case "save":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 8.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M8 6h8l2 3H6l2-3z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M12 11v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M9.5 14.5 12 17l2.5-2.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "free":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="8" cy="11" r="3.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11.5 11h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M16.5 9v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M5.5 16.5c1.2-1.5 2.6-2 4.5-2s3.3.5 4.5 2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

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
            <p className="kicker">What you get</p>
            <h2 id="features-title">Built to download. Nothing else.</h2>
            <p className="features-lede">
              Same flow as the hero — paste a link, choose a format, save to disk. No library, no cloud, no upsell.
            </p>
          </div>

          <div className="workflow-wrap">
            <ol className="workflow" aria-label="Download workflow">
              {features.map((f, i) => (
                <li
                  className={`workflow-step workflow-step--${f.step}${i === features.length - 1 ? " workflow-step--last" : ""}`}
                  key={f.n}
                >
                  <div className="workflow-node" aria-hidden="true">
                    <span className="workflow-node-ring" />
                    <span className="workflow-icon">
                      <WorkflowIcon step={f.step} />
                    </span>
                  </div>
                  <div className="workflow-copy">
                    <span className="workflow-n">{f.n}</span>
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                  </div>
                </li>
              ))}
            </ol>
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