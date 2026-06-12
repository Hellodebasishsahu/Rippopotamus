import { useState, useRef, useEffect } from "react";
import { FeatureArt, type Motif } from "./FeatureArt";
import { SiYoutube, SiInstagram, SiTwitch, SiReddit, SiSoundcloud, SiFacebook, SiX, SiPinterest, SiDailymotion, SiBilibili, SiSnapchat, SiSpotify, SiTumblr, SiDiscord, SiTiktok, SiVimeo } from "react-icons/si";
import { FaApple, FaLinkedin } from "react-icons/fa";

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
    title: "Audio Extraction",
    body: "Drop a video link, get a high-quality MP3. Perfect for podcasts, stems, or offline listening—no messy converters needed.",
    accent: "coral",
    motif: "lilypads",
  },
  {
    id: "preview",
    index: "02.",
    title: "Playlists & Channels",
    body: "Paste a playlist link and grab the whole batch at once. Rippo lines them up and handles the heavy lifting in the background.",
    accent: "mint",
    motif: "bloom",
  },
  {
    id: "presets",
    index: "03.",
    title: "Highest Quality",
    body: "Pulls the uncompressed 4K/8K video streams and master audio that typical browser extensions simply can't reach.",
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

const marqueeIcons = [
  { Icon: SiTiktok, name: "tiktok" },
  { Icon: SiVimeo, name: "vimeo" },
  { Icon: SiPinterest, name: "pinterest" },
  { Icon: FaLinkedin, name: "linkedin" },
  { Icon: SiDailymotion, name: "dailymotion" },
  { Icon: SiBilibili, name: "bilibili" },
  { Icon: SiSnapchat, name: "snapchat" },
  { Icon: SiSpotify, name: "spotify" },
  { Icon: FaApple, name: "apple" },
  { Icon: SiTumblr, name: "tumblr" },
  { Icon: SiDiscord, name: "discord" },
  { Icon: SiYoutube, name: "youtube" },
  { Icon: SiInstagram, name: "instagram" },
  { Icon: SiTwitch, name: "twitch" },
  { Icon: SiReddit, name: "reddit" },
  { Icon: SiSoundcloud, name: "soundcloud" },
  { Icon: SiFacebook, name: "facebook" },
  { Icon: SiX, name: "x" }
];

const doubleMarqueeIcons = [...marqueeIcons, ...marqueeIcons];

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1440, height: 60 });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width || 1440,
          height: rect.height || 60,
        });
      }
    };

    updateDimensions();

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);

    window.addEventListener("resize", updateDimensions);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDimensions);
    };
  }, []);

  const scaleX = dimensions.width / 1440;
  const scaleY = dimensions.height / 120;
  const yOffset = -22; // Lift icons slightly above the curve so they ride on it

  const path = `M ${-80 * scaleX} ${(24 + yOffset) * scaleY} C ${-40 * scaleX} ${(28 + yOffset) * scaleY} ${-20 * scaleX} ${(30 + yOffset) * scaleY} 0 ${(32 + yOffset) * scaleY} C ${320 * scaleX} ${(100 + yOffset) * scaleY} ${720 * scaleX} ${(10 + yOffset) * scaleY} ${1080 * scaleX} ${(80 + yOffset) * scaleY} C ${1260 * scaleX} ${(115 + yOffset) * scaleY} ${1380 * scaleX} ${(60 + yOffset) * scaleY} ${1440 * scaleX} ${(48 + yOffset) * scaleY} C ${1460 * scaleX} ${(46 + yOffset) * scaleY} ${1480 * scaleX} ${(45 + yOffset) * scaleY} ${1520 * scaleX} ${(44 + yOffset) * scaleY}`;

  return (
    <div className="page">
      <div className="grain" aria-hidden="true" />

      <main className="main-content" style={{ paddingTop: 0 }}>
        <div className="glow glow-a" aria-hidden="true" />
        <div className="glow glow-b" aria-hidden="true" />
        <div className="glow glow-c" aria-hidden="true" />
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
            </div>
          </div>
        </section>

        {/* Marquee Section */}
        <section className="marquee-section" aria-hidden="true">
          <div className="marquee-curve-container" ref={containerRef}>
            {marqueeIcons.map(({ Icon, name }, idx) => {
              const delay = -(36 / marqueeIcons.length) * idx;
              return (
                <div
                  key={idx}
                  className="marquee-curve-wrapper"
                  style={{
                    offsetPath: `path('${path}')`,
                    animationDelay: `${delay}s`,
                    animationDuration: "36s",
                  }}
                >
                  <div className={`marquee-curve-icon ${name}`}>
                    <Icon size={24} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Features Section */}
        <section className="features" id="features" aria-labelledby="features-title">
          <div className="section-divider section-divider--top" aria-hidden="true">
            <svg viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
              {/* Helper Wave */}
              <path
                d="M0,16 C320,84 720,-6 1080,64 C1260,99 1380,44 1440,32 L1440,120 L0,120 Z"
                fill="var(--deep)"
                opacity="0.15"
              />
              {/* Back Wave */}
              <path
                d="M0,32 C320,100 720,10 1080,80 C1260,115 1380,60 1440,48 L1440,120 L0,120 Z"
                fill="var(--deep)"
                opacity="0.3"
              />
              {/* Main Wave */}
              <path
                d="M0,64 C360,120 720,40 1080,100 C1260,130 1380,90 1440,80 L1440,120 L0,120 Z"
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
              {/* Main Wave — fills the manifesto color above the curve, transparent below so the footer wordmark shows through */}
              <path
                d="M0,64 C360,120 720,40 1080,100 C1260,130 1380,90 1440,80 L1440,0 L0,0 Z"
                fill="var(--ink)"
              />
            </svg>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="foot">
        <div className="big-name-wrapper" aria-hidden="true">
          <div className="big-name">RIPPOPOTAMUS</div>
        </div>
      </footer>
    </div>
  );
}