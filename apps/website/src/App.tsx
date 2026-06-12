const macDownloadUrl = "/downloads/Rippopotamus-0.1.0-arm64.dmg";

const features = [
  {
    n: "01",
    title: "Paste anything",
    body: "One URL or a whole list. Rippo fetches metadata and thumbnails before you commit disk space.",
  },
  {
    n: "02",
    title: "Pick your format",
    body: "Resolution, container, audio-only — choose per item or set a default and move on.",
  },
  {
    n: "03",
    title: "Save locally",
    body: "Files land in your folder. No cloud hop, no vendor vault, no export unlock.",
  },
  {
    n: "04",
    title: "Stay free",
    body: "Open source, no account, no subscription. The engines are yours — Rippo just runs them.",
  },
];

export function App() {
  return (
    <div className="page">
      <div className="grain" aria-hidden="true" />
      <div className="glow glow-a" aria-hidden="true" />
      <div className="glow glow-b" aria-hidden="true" />

      <header className="top">
        <a className="mark" href="/" aria-label="Rippo home">
          <img src="/brand-logo.png" alt="" width={36} height={36} />
          <span>Rippo</span>
        </a>
        <nav className="top-nav" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#download">Download</a>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-inner">
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
        </section>

        <section className="features" id="features" aria-labelledby="features-title">
          <div className="features-head">
            <p className="kicker">What you get</p>
            <h2 id="features-title">Built to download. Nothing else.</h2>
          </div>
          <div className="feature-grid">
            {features.map((f) => (
              <article className="feature" key={f.n}>
                <span className="feature-n">{f.n}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
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
        <span>© {new Date().getFullYear()} Rippo</span>
      </footer>
    </div>
  );
}