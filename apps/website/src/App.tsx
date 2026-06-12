import {
  Cookie,
  FolderDown,
  Layers,
  Radar,
  ScanEye,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

const macDownloadUrl = "/downloads/Rippopotamus-0.1.0-arm64.dmg";

const features: {
  id: string;
  title: string;
  body: string;
  accent: "coral" | "mint";
  span: "wide" | "normal";
  icon: LucideIcon;
}[] = [
  {
    id: "batch",
    title: "Batch queues",
    body: "Paste one link or fifty — URLs, playlists, magnets. Rippo fetches metadata in parallel, then saves with concurrent workers.",
    accent: "coral",
    span: "wide",
    icon: Layers,
  },
  {
    id: "preview",
    title: "Preview before you save",
    body: "Thumbnails, titles, duration, and platform show up in the queue so you never commit disk space blind.",
    accent: "mint",
    span: "normal",
    icon: ScanEye,
  },
  {
    id: "presets",
    title: "Editor presets",
    body: "Best MP4, MP3, 720p proxy, thumbnails, image galleries, Drive files, torrents — per item or bulk.",
    accent: "mint",
    span: "normal",
    icon: SlidersHorizontal,
  },
  {
    id: "sniff",
    title: "Sniff messy pages",
    body: "One ugly link? Rippo crawls the page with bundled Chromium, scores playable media, and queues up to 40 candidates.",
    accent: "coral",
    span: "wide",
    icon: Radar,
  },
  {
    id: "local",
    title: "Organized local saves",
    body: "Files land in Source/, Audio/, Images/ under your chosen folder — sane filenames, duplicate detection, open in Finder.",
    accent: "mint",
    span: "normal",
    icon: FolderDown,
  },
  {
    id: "access",
    title: "Hard sources, handled",
    body: "Export browser cookies for yt-dlp, test HTTP/SOCKS proxies, or flip Private mode for sensitive grabs.",
    accent: "coral",
    span: "normal",
    icon: Cookie,
  },
];

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
              Batch queues, real previews, editor presets, page sniffing, local folders — the stuff paid apps charge monthly for.
            </p>
          </div>

          <div className="feature-grid">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <article
                  key={f.id}
                  className={`feature-card feature-card--${f.accent}${f.span === "wide" ? " feature-card--wide" : ""}`}
                >
                  <div className="feature-art" aria-hidden="true">
                    <div className="feature-icon-wrap">
                      <Icon className="feature-icon" strokeWidth={1.75} absoluteStrokeWidth />
                    </div>
                  </div>
                  <div className="feature-copy">
                    <h3 className="feature-title">{f.title}</h3>
                    <p className="feature-body">{f.body}</p>
                  </div>
                </article>
              );
            })}
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