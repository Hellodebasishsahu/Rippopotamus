const logoUrl = `${import.meta.env.BASE_URL}brand-logo.png`;

export function AppHero() {
  return (
    <section className="app-hero" aria-labelledby="app-hero-title">
      <img className="app-hero-logo" src={logoUrl} alt="" width={72} height={72} decoding="async" />
      <h1 id="app-hero-title" className="app-hero-title">Rippo</h1>
      <p className="app-hero-tagline">Save anything you're logged into.</p>
    </section>
  );
}
