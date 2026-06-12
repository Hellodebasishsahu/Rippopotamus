const macDownloadUrl = "/downloads/Rippopotamus-0.1.0-arm64.dmg";

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
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
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