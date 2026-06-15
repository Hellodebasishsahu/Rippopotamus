import { useState, useRef } from "react";
import { MarqueeSection } from "./MarqueeSection";
import { FeaturesSection } from "./FeaturesSection";
import { DownloadCta } from "./DownloadCta";
import { HeroIconHalo } from "./HeroIconHalo";

type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

const faqItems: FaqItem[] = [
  {
    id: "what",
    question: "What is Rippopotamus?",
    answer:
      "A local desktop media downloader for editors and designers. Paste a link, even one behind a login, and Rippo uses your own browser session to pull pristine files into clean project folders on your hard drive. No browser tabs, no sketchy converter sites.",
  },
  {
    id: "free",
    question: "Is it free?",
    answer:
      "Yes. No ads, no subscriptions, no upsells. You download the app, your files stay on your machine, and that's the whole deal.",
  },
  {
    id: "platforms",
    question: "What sites and platforms does it support?",
    answer:
      "YouTube, TikTok, Instagram, Twitch, Vimeo, SoundCloud, Pinterest, Reddit, and dozens more. Basically anywhere yt-dlp and gallery-dl can reach. Paste a link and Rippo figures out the best source.",
  },
  {
    id: "windows",
    question: "Does it work on Windows?",
    answer:
      "Mac is available now. Windows builds are in progress. You can package for Windows from the repo today, and a signed installer is on the roadmap.",
  },
  {
    id: "quality",
    question: "What quality do I actually get?",
    answer:
      "The best source available, up to 4K/8K video and master audio when the platform serves it. Rippo pulls uncompressed streams that typical browser extensions can't touch, then hands you MP4, MP3, thumbnails, or image galleries.",
  },
  {
    id: "playlists",
    question: "Can I batch-download playlists and channels?",
    answer:
      "Not yet. Rippo currently focuses on individual media links. You can paste many URLs at once for batch processing, but automatic playlist and channel expansion is on the roadmap.",
  },
  {
    id: "folders",
    question: "Where do my files end up?",
    answer:
      "Organized project folders, not a messy Downloads dump. Source, Audio, Images, Thumbnails, and Clips each get their own directory with sane filenames, plus a manifest.json that tracks every source URL.",
  },
  {
    id: "private",
    question: "What about private or gated links?",
    answer:
      "Authenticate once through your browser cookies and Rippo can pull from client boards, members-only posts, and other gated platforms you already have access to.",
  },
  {
    id: "privacy",
    question: "Is anything sent to the cloud?",
    answer:
      "No. Rippo runs entirely on your machine. Links, downloads, and credentials never leave your computer. Local-first by design.",
  },
  {
    id: "vs-extensions",
    question: "How is this different from a browser extension?",
    answer:
      "Extensions are capped by what the browser allows, cluttered with ads, and dump files wherever Chrome decides. Rippo is a native app with full-quality extraction, batch workflows, and editor-ready folder structure.",
  },
  {
    id: "deps",
    question: "Do I need to install Python or ffmpeg?",
    answer:
      "For now, yes for Python. The app bundles ffmpeg and aria2c, but you currently need Python 3.11+ and yt-dlp installed on your system. A fully standalone app is on the roadmap.",
  },
  {
    id: "failures",
    question: "What happens when a link fails?",
    answer:
      "You get a plain-English error, not a cryptic log dump, plus a retry button. Failed links stay in your queue so you can fix cookies, switch presets, or try again without starting over.",
  },
  {
    id: "legal",
    question: "Is downloading content legal?",
    answer:
      "Rippo is a tool. You're responsible for having the rights to download and use whatever you grab: client deliverables, licensed stock, your own uploads, etc. We don't host or redistribute anyone's content.",
  },
  {
    id: "updates",
    question: "How do I get updates?",
    answer:
      "Check the site for new releases. Auto-update is coming. For now, grab the latest .dmg when we ship a new version.",
  },
];

export function App() {
  return (
    <div className="page">
      <div className="grain" aria-hidden="true" />

      <main className="main-content">
        <div className="glow glow-a" aria-hidden="true" />
        <div className="glow glow-b" aria-hidden="true" />
        <div className="glow glow-c" aria-hidden="true" />

        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-inner">
            <div className="hero-copy">
              <h1 id="hero-title">
                <span className="line">If you can see it,</span>
                <span className="line accent">you can download it.</span>
              </h1>
              <p className="lede">
                Download full-quality video and audio from anywhere, even the logged-in stuff other tools can't reach.
              </p>
              <DownloadCta />
            </div>

            <div className="hero-brand" aria-hidden="true">
              <HeroIconHalo />
              <div className="logo-glow" />
              <picture>
                <source
                  media="(max-width: 900px)"
                  srcSet="/brand-logo-360.webp"
                  type="image/webp"
                />
                <source srcSet="/brand-logo.webp" type="image/webp" />
                <img
                  className="logo-mark"
                  src="/brand-logo.png"
                  alt=""
                  width={360}
                  height={360}
                  decoding="async"
                  fetchPriority="high"
                />
              </picture>
            </div>
          </div>
        </section>

        <MarqueeSection />
        <FeaturesSection />

        <section className="faq" id="faq" aria-labelledby="faq-title">
          <div className="faq-inner">
            <header className="faq-head">
              <h2 id="faq-title">FAQ</h2>
            </header>

            <div className="faq-grid" role="list">
              <FaqList items={faqItems} />
            </div>
          </div>
        </section>

        <section className="manifesto" aria-labelledby="manifesto-title">
          <blockquote id="manifesto-title">
            Stop fighting with sketchy ad-filled sites and bloated subscription apps.
            <em> Get your media. Get back to creating.</em>
          </blockquote>
        </section>
      </main>
    </div>
  );
}

function FaqList({ items }: { items: { id: string; question: string; answer: string }[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const half = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, half);
  const rightItems = items.slice(half);

  const renderItem = (item: { id: string; question: string; answer: string }) => (
    <div key={item.id} id={item.id} className={`faq-item ${openId === item.id ? "faq-item--open" : ""}`} role="listitem">
      <button 
        className="faq-question" 
        onClick={() => setOpenId(openId === item.id ? null : item.id)}
        aria-expanded={openId === item.id}
      >
        <span>{item.question}</span>
        <span className="faq-icon" aria-hidden="true" />
      </button>
      <div className="faq-answer">
        <div className="faq-answer-inner">
          <p>{item.answer}</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="faq-column">
        {leftItems.map(renderItem)}
      </div>
      <div className="faq-column">
        {rightItems.map(renderItem)}
      </div>
    </>
  );
}
