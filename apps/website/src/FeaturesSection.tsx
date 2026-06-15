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
    title: "Batch Link Intake",
    body: "Paste dozens of media links at once. Rippo lines them up, fetches metadata up front, and handles the heavy lifting in the background.",
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
    body: "Skip the messy Downloads folder. Rippo automatically sorts your assets into clean Source, Audio, and Image directories with sane filenames.",
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
