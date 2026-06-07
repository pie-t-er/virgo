import logo from "../virgo_logo.png";
import "./Landing.css";

const FEATURES = [
  {
    icon: "👗",
    title: "Your closet, catalogued",
    desc: "Add clothing by describing it in plain language. Virgo handles the rest — type, colour, occasion, season.",
  },
  {
    icon: "✦",
    title: "AI outfit recommendations",
    desc: "Ask for an outfit for any occasion. Virgo searches your actual wardrobe using semantic AI, not guesswork.",
  },
  {
    icon: "⏱️",
    title: "Stop wasting mornings",
    desc: "No more staring at your wardrobe. Ask Virgo for an outfit in seconds and walk out the door with confidence.",
  },
  {
    icon: "📅",
    title: "Plan your week ahead",
    desc: "Schedule outfits for the whole week on Sunday. Virgo avoids repeats and remembers what you've already worn.",
  },
  {
    icon: "🔄",
    title: "Wear everything you own",
    desc: "Most clothes get worn a handful of times and forgotten. Virgo rotates your full wardrobe so nothing collects dust.",
  },
  {
    icon: "🛍️",
    title: "Shop smarter",
    desc: "Find out exactly what's missing before you buy. Virgo analyses your wardrobe against common outfit patterns.",
  },
];

export default function Landing({ onEnter }) {
  return (
    <div className="landing">
      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-nav-logo">
          <img src={logo} alt="Virgo" className="nav-logo-img" />
          <span>Virgo</span>
        </div>
        <button className="landing-nav-cta" onClick={onEnter}>
          Open app →
        </button>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="hero-glow" />
        <img src={logo} alt="Virgo" className="hero-logo" />
        <h1 className="hero-title">
          Your wardrobe,<br />
          <span className="hero-accent">your style.</span>
        </h1>
        <p className="hero-sub">
          An AI agent that knows your wardrobe better than you do.
          Semantic outfit recommendations, a weekly style calendar, and
          a conversational interface that actually understands what you own.
        </p>
        <div className="hero-actions">
          <button className="btn-primary" onClick={onEnter}>
            Get started
          </button>
          <a className="btn-ghost" href="#about">
            Learn more
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="landing-features">
        <h2 className="section-title">Everything your wardrobe needs</h2>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <span className="feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About / Philosophy */}
      <section className="landing-about" id="about">
        <div className="about-inner">
          <div className="about-text">
            <span className="about-eyebrow">Philosophy</span>
            <h2>Powered by Google AI and MongoDB Atlas.</h2>
            <p>
              Virgo is built on Google ADK with Gemini, backed by MongoDB Atlas
              Vector Search. Every outfit recommendation is grounded in your
              actual wardrobe — no hallucinations, no generic suggestions.
            </p>
            <ul className="about-list">
              <li>
                <span className="list-dot orange" />
                Semantic search via Atlas Vector Search
              </li>
              <li>
                <span className="list-dot orange" />
                Gemini-powered outfit reasoning
              </li>
              <li>
                <span className="list-dot orange" />
                Automatic model rotation across 6 Gemini variants
              </li>
              <li>
                <span className="list-dot orange" />
                Open source — inspect every line
              </li>
            </ul>
          </div>
          <div className="about-logo-wrap">
            <img src={logo} alt="Virgo" className="about-logo" />
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="landing-cta">
        <h2>Ready to know your wardrobe?</h2>
        <button className="btn-primary large" onClick={onEnter}>
          Start for free →
        </button>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-logo">
          <img src={logo} alt="Virgo" className="nav-logo-img" />
          <span>Virgo</span>
        </div>
        <p>Built for the Google Cloud Rapid Agent Hackathon · MongoDB track</p>
        <a
          href="https://github.com/pie-t-er/virgo"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </footer>
    </div>
  );
}
