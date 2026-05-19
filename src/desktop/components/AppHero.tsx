import { BrandIcon } from "./BrandIcon";

const logoUrl = `${import.meta.env.BASE_URL}brand-logo.png`;

export function AppHero() {
  return (
    <section className="app-hero" aria-labelledby="app-hero-title">
      <img className="app-hero-logo" src={logoUrl} alt="" width={72} height={72} decoding="async" />
      <h1 id="app-hero-title" className="app-hero-title">Rippo</h1>
      <p className="app-hero-tagline">Sheet to editor-ready project folder.</p>
      <ul className="app-hero-flow" aria-label="Workflow">
        <li>
          <BrandIcon brand="google-sheets" size={20} />
          <span>Tracker sheet</span>
        </li>
        <li className="app-hero-flow-arrow" aria-hidden>→</li>
        <li>
          <span className="app-hero-flow-dot" aria-hidden />
          <span>Project + manifest</span>
        </li>
        <li className="app-hero-flow-arrow" aria-hidden>→</li>
        <li>
          <BrandIcon brand="google-drive" size={20} />
          <span>Drive masters</span>
        </li>
      </ul>
    </section>
  );
}
