import { lazy, Suspense } from "react";
import type { Motif } from "./FeatureArt";

const FeatureArt = lazy(() =>
  import("./FeatureArt").then((module) => ({ default: module.FeatureArt })),
);

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
    id: "access",
    index: "01.",
    title: "Logged In? Then It's Yours",
    body: "If you can open it in your browser, Rippo can save it: your Instagram and Facebook, Drive files, members-only posts, private client boards. It borrows your existing session locally and never sees your password.",
    accent: "coral",
    motif: "lotus",
  },
  {
    id: "presets",
    index: "02.",
    title: "Masters, Not Previews",
    body: "Rippo grabs the original stream (4K, 8K, lossless master audio), not the squished preview that browser extensions settle for.",
    accent: "mint",
    motif: "reeds",
  },
  {
    id: "local",
    index: "03.",
    title: "Drops Straight Into the Edit",
    body: "Files land pre-sorted into Source, Audio, and Images with clean, searchable names and a manifest of every URL. Open the folder and start cutting.",
    accent: "mint",
    motif: "stream",
  },
  {
    id: "batch",
    index: "04.",
    title: "Audio in One Paste",
    body: "Drop a video link, get a clean MP3 or WAV for reference tracks, podcast pulls, or scratch audio. No converter sites, no watermarks.",
    accent: "coral",
    motif: "lilypads",
  },
  {
    id: "preview",
    index: "05.",
    title: "A Hundred Links at Once",
    body: "Paste the whole list. Rippo reads the metadata, lines everything up, and works through the queue in the background while you keep moving.",
    accent: "mint",
    motif: "bloom",
  },
  {
    id: "sniff",
    index: "06.",
    title: "No Download Button? No Problem",
    body: "When media is buried in a messy page with nothing to click, Rippo digs through the source and surfaces the highest-quality file it can find.",
    accent: "coral",
    motif: "ripples",
  },
];

function FeatureArtFallback() {
  return <div className="feature-art-fallback" aria-hidden="true" />;
}

export function FeaturesSection() {
  return (
    <section className="features" id="features" aria-labelledby="features-title">
      <div className="section-divider section-divider--top" aria-hidden="true">
        <svg viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none">
          <path
            d="M0,16 C320,84 720,-6 1080,64 C1260,99 1380,44 1440,32 L1440,120 L0,120 Z"
            fill="var(--deep)"
            opacity="0.15"
          />
          <path
            d="M0,32 C320,100 720,10 1080,80 C1260,115 1380,60 1440,48 L1440,120 L0,120 Z"
            fill="var(--deep)"
            opacity="0.3"
          />
          <path
            d="M0,64 C360,120 720,40 1080,100 C1260,130 1380,90 1440,80 L1440,120 L0,120 Z"
            fill="var(--deep)"
          />
        </svg>
      </div>
      <div className="features-inner">
        <div className="editorial-divider" aria-hidden="true" />

        <div className="feature-grid">
          {features.map((feature) => (
            <article
              key={feature.id}
              className={`feature-card feature-card--${feature.accent}`}
            >
              <div className="feature-art" aria-hidden="true">
                <Suspense fallback={<FeatureArtFallback />}>
                  <FeatureArt motif={feature.motif} accent={feature.accent} />
                </Suspense>
              </div>
              <div className="feature-copy">
                <span className="feature-index">{feature.index}</span>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-body">{feature.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="section-divider section-divider--bottom" aria-hidden="true">
        <svg viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none">
          <path
            d="M0,48 C320,0 720,70 1080,10 C1260,0 1380,20 1440,32 L1440,120 L0,120 Z"
            fill="var(--ink)"
            opacity="0.25"
          />
          <path
            d="M0,80 C360,10 720,90 1080,20 C1260,0 1380,40 1440,48 L1440,120 L0,120 Z"
            fill="var(--ink)"
          />
        </svg>
      </div>
    </section>
  );
}
