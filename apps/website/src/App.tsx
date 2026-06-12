import { FeatureArt, type Motif } from "./FeatureArt";
import { ExternalLink } from "lucide-react";
import { SiYoutube, SiInstagram, SiTwitch, SiReddit, SiSoundcloud, SiFacebook, SiX } from "react-icons/si";
import { FaApple } from "react-icons/fa";

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
    title: "Drop in your links",
    body: "Paste a single video, a massive playlist, or a whole moodboard of URLs. Rippo handles the heavy lifting in the background.",
    accent: "coral",
    motif: "lilypads",
  },
  {
    id: "preview",
    index: "02.",
    title: "See it before you save",
    body: "Thumbnails, formats, and high-res previews load instantly. Know exactly what you're getting before it eats up your disk space.",
    accent: "mint",
    motif: "bloom",
  },
  {
    id: "presets",
    index: "03.",
    title: "Editor-ready formats",
    body: "Need a crisp 4K MP4 for Premiere? A quick 720p proxy? Or just a high-res thumbnail? Choose your preset and let Rippo convert it.",
    accent: "mint",
    motif: "reeds",
  },
  {
    id: "sniff",
    index: "04.",
    title: "Extract from anywhere",
    body: "Found a video buried on a messy website? Rippo digs through the page and pulls out the highest quality media available.",
    accent: "coral",
    motif: "ripples",
  },
  {
    id: "local",
    index: "05.",
    title: "Pristine project folders",
    body: "Skip the messy Downloads folder. Rippo automatically sorts your assets into clean Audio, Video, and Image directories with sane filenames.",
    accent: "mint",
    motif: "stream",
  },
  {
    id: "access",
    index: "06.",
    title: "Private links, handled",
    body: "Need to pull an asset from a client's private board or a gated platform? Authenticate once and let Rippo grab what you need.",
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
              <h1 id="hero-title">
                <span className="line">Drop links.</span>
                <span className="line">Get assets.</span>
                <span className="line accent">Create.</span>
              </h1>
              <p className="lede">
                The clean, lightning-fast media downloader built for editors and designers. No ads, no subscriptions, just pristine files straight to your hard drive.
              </p>
              <div className="hero-cta" id="download">
                <a className="btn-main" href={macDownloadUrl} download>
                  <span className="btn-main-title">
                    Download for Mac
                    <FaApple size={18} style={{ display: "inline-block", verticalAlign: "middle", marginLeft: "8px", position: "relative", top: "-2px" }} />
                  </span>
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
              <div className="platform-icon float-yt" title="YouTube"><SiYoutube size={20} /></div>
              <div className="platform-icon float-x" title="X (Twitter)"><SiX size={18} /></div>
              <div className="platform-icon float-ig" title="Instagram"><SiInstagram size={20} /></div>
              <div className="platform-icon float-twitch" title="Twitch"><SiTwitch size={20} /></div>
              <div className="platform-icon float-reddit" title="Reddit"><SiReddit size={20} /></div>
              <div className="platform-icon float-soundcloud" title="SoundCloud"><SiSoundcloud size={20} /></div>
              <div className="platform-icon float-fb" title="Facebook"><SiFacebook size={20} /></div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="features" id="features" aria-labelledby="features-title">
          <div className="section-divider section-divider--top" aria-hidden="true">
            <svg viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
              {/* Back Wave */}
              <path
                d="M0,64 C360,120 720,40 1080,100 C1260,130 1380,90 1440,80 L1440,120 L0,120 Z"
                fill="var(--deep)"
                opacity="0.3"
              />
              {/* Main Wave */}
              <path
                d="M0,32 C320,100 720,10 1080,80 C1260,115 1380,60 1440,48 L1440,120 L0,120 Z"
                fill="var(--deep)"
              />
            </svg>
          </div>
          <div className="features-botanical" aria-hidden="true" />
          <div className="features-inner">
            <div className="editorial-divider" aria-hidden="true" />

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
          <div className="section-divider section-divider--bottom" aria-hidden="true">
            <svg viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
              {/* Back Wave */}
              <path
                d="M0,48 C320,0 720,70 1080,10 C1260,0 1380,20 1440,32 L1440,120 L0,120 Z"
                fill="var(--ink)"
                opacity="0.25"
              />
              {/* Main Wave */}
              <path
                d="M0,80 C360,10 720,90 1080,20 C1260,0 1380,40 1440,48 L1440,120 L0,120 Z"
                fill="var(--ink)"
              />
            </svg>
          </div>
        </section>

        {/* Manifesto Section */}
        <section className="manifesto" aria-labelledby="manifesto-title">
          <blockquote id="manifesto-title">
            Stop fighting with sketchy ad-filled sites and bloated subscription apps.
            <em> Get your media. Get back to creating.</em>
          </blockquote>
          <div className="section-divider section-divider--footer" aria-hidden="true">
            <svg viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
              {/* Back Wave */}
              <path
                d="M0,64 C360,120 720,40 1080,100 C1260,130 1380,90 1440,80 L1440,120 L0,120 Z"
                fill="var(--deep)"
                opacity="0.3"
              />
              {/* Main Wave */}
              <path
                d="M0,32 C320,100 720,10 1080,80 C1260,115 1380,60 1440,48 L1440,120 L0,120 Z"
                fill="var(--deep)"
              />
            </svg>
          </div>
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