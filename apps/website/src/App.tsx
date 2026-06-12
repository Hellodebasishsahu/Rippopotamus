import { FeatureArt, type Motif } from "./FeatureArt";
import { Laptop, ExternalLink } from "lucide-react";

const macDownloadUrl = "/downloads/Rippopotamus-0.1.0-arm64.dmg";

type FeatureItem = {
  id: string;
  index: string;
  title: string;
  body: string;
  accent: "coral" | "mint";
  motif: Motif;
};

const features: FeatureItem[] = [
  {
    id: "batch",
    index: "01.",
    title: "Batch queues",
    body: "Paste one link or fifty — URLs, playlists, magnets. Rippo fetches metadata in parallel, then saves with concurrent workers.",
    accent: "coral",
    motif: "lilypads",
  },
  {
    id: "preview",
    index: "02.",
    title: "Preview before you save",
    body: "Thumbnails, titles, duration, and platform show up in the queue so you never commit disk space blind.",
    accent: "mint",
    motif: "bloom",
  },
  {
    id: "presets",
    index: "03.",
    title: "Editor presets",
    body: "Best MP4, MP3, 720p proxy, thumbnails, image galleries, Drive files, torrents — per item or bulk.",
    accent: "mint",
    motif: "reeds",
  },
  {
    id: "sniff",
    index: "04.",
    title: "Sniff messy pages",
    body: "One ugly link? Rippo crawls the page with bundled Chromium, scores playable media, and queues up to 40 candidates.",
    accent: "coral",
    motif: "ripples",
  },
  {
    id: "local",
    index: "05.",
    title: "Organized local saves",
    body: "Files land in Source/, Audio/, Images/ under your chosen folder — sane filenames, duplicate detection, open in Finder.",
    accent: "mint",
    motif: "stream",
  },
  {
    id: "access",
    index: "06.",
    title: "Hard sources, handled",
    body: "Export browser cookies for yt-dlp, test HTTP/SOCKS proxies, or flip Private mode for sensitive grabs.",
    accent: "coral",
    motif: "lotus",
  },
];

export function App() {
  return (
    <div className="page">
      <div className="grain" aria-hidden="true" />
      <div className="glow glow-a" aria-hidden="true" />
      <div className="glow glow-b" aria-hidden="true" />
      <div className="glow glow-c" aria-hidden="true" />

      <main style={{ paddingTop: 0 }}>
        {/* Hero Section */}
        <section className="hero" aria-labelledby="hero-title" style={{ minHeight: "100vh" }}>
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="kicker">Open source downloader · macOS</p>
              <h1 id="hero-title">
                <span className="line">Paste.</span>
                <span className="line">Pick.</span>
                <span className="line accent">Save.</span>
              </h1>
              <p className="lede">
                The media downloader you were about to subscribe to — except it&apos;s free,
                runs on your machine, and never phones home. Built for designers, editors, and creators.
              </p>
              <div className="hero-cta" id="download">
                <a className="btn-main" href={macDownloadUrl} download>
                  <span className="btn-main-title">
                    Get Rippo for Mac <Laptop size={16} style={{ display: "inline", verticalAlign: "middle", marginLeft: "4px" }} />
                  </span>
                  <small>Apple Silicon · DMG · $0/mo</small>
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

        {/* Features Section */}
        <section className="features" id="features" aria-labelledby="features-title">
          <div className="features-botanical" aria-hidden="true" />
          <div className="features-inner">
            <div className="features-head">
              <p className="kicker">Features</p>
              <h2 id="features-title">
                Built to download.
                <span className="features-title-line">Nothing else.</span>
              </h2>
              <p className="features-lede">
                Batch queues, real previews, editor presets, page sniffing, local folders — the stuff paid apps charge monthly for.
              </p>
            </div>

            <div className="feature-grid">
              {features.map((f) => (
                <article
                  key={f.id}
                  className={`feature-card feature-card--${f.accent}`}
                >
                  <div className="feature-art" aria-hidden="true">
                    <FeatureArt motif={f.motif} accent={f.accent} />
                  </div>
                  <div className="feature-copy">
                    <span className="feature-index">{f.index}</span>
                    <h3 className="feature-title">{f.title}</h3>
                    <p className="feature-body">{f.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Manifesto Section */}
        <section className="manifesto" aria-labelledby="manifesto-title">
          <blockquote id="manifesto-title">
            Paid downloaders rent you the same engines you can run yourself.
            <em> Rippo just gets out of the way.</em>
          </blockquote>
        </section>
      </main>

      {/* Footer */}
      <footer className="foot">
        <div className="foot-inner">
          <div className="foot-logo-group">
            <img className="foot-logo" src="/brand-logo.png" alt="" width={28} height={28} />
            <span>© {new Date().getFullYear()} Rippo Project</span>
          </div>
          <div className="foot-links">
            <a href="https://github.com/Hellodebasishsahu/Rippopotamus" target="_blank" rel="noopener noreferrer" className="foot-link">
              GitHub <ExternalLink size={12} style={{ display: "inline", verticalAlign: "middle" }} />
            </a>
            <span className="separator">•</span>
            <a href="#features" className="foot-link">Features</a>
            <span className="separator">•</span>
            <span className="license-tag">MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  );
}