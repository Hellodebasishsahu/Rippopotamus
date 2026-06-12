import { useEffect, useState } from "react";

const macDownloadUrl = "/downloads/Rippopotamus-0.1.0-arm64.dmg";

const queueDemo = [
  { title: "keynote_recording.mp4", host: "vimeo.com", state: "ready", pct: null },
  { title: "album_014_full", host: "imgur.com", state: "dl", pct: 68 },
  { title: "interview_cut_03", host: "youtube.com", state: "done", pct: 100 },
];

export function App() {
  const [typed, setTyped] = useState("");
  const sampleUrl = "https://vimeo.com/824804225";

  useEffect(() => {
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(sampleUrl.slice(0, i));
      if (i >= sampleUrl.length) window.clearInterval(id);
    }, 38);
    return () => window.clearInterval(id);
  }, []);

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
          <div className="hero-text">
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

          <div className="window" aria-label="Rippo app preview">
            <div className="window-chrome">
              <span /><span /><span />
              <p>rippo — local</p>
            </div>
            <div className="window-body">
              <label className="url-field">
                <span className="url-label">input</span>
                <span className="url-value">{typed}<i className="caret" aria-hidden="true" /></span>
              </label>
              <div className="window-actions">
                <button type="button" className="chip">Auto</button>
                <button type="button" className="chip ghost">Sniff</button>
                <button type="button" className="chip solid">Fetch</button>
              </div>
              <ul className="queue" aria-label="Download queue preview">
                {queueDemo.map((row) => (
                  <li key={row.title} className={`queue-row ${row.state}`}>
                    <span className="thumb" aria-hidden="true" />
                    <div className="meta">
                      <strong>{row.title}</strong>
                      <span>{row.host}</span>
                    </div>
                    <span className="state">
                      {row.state === "ready" ? "ready" : row.state === "done" ? "done" : `${row.pct}%`}
                    </span>
                    {row.pct != null && row.state === "dl" ? (
                      <span className="bar" aria-hidden="true"><i style={{ width: `${row.pct}%` }} /></span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
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