import { colors } from "../theme";

interface LandingPageProps {
  onStartImprov: () => void;
}

const FEATURES = [
  {
    emoji: "🎭",
    title: "Multiplayer Canvas",
    desc: "Improvise scenes with friends on a shared stage. Everyone sees every move in real time.",
  },
  {
    emoji: "🤖",
    title: "AI Scene Partner",
    desc: "AI creates props, characters, and complications that escalate your story one notch at a time.",
  },
  {
    emoji: "🎮",
    title: "Game Modes",
    desc: "Freeze Tag, Scenes From a Hat, Yes-And Chain. Pick a mode, set a scene, see what breaks.",
  },
  {
    emoji: "👀",
    title: "Watch & Heckle",
    desc: "Spectators react and inject one-liners into the scene. Comedy is better with an audience.",
  },
];

export function LandingPage({ onStartImprov }: LandingPageProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "inherit",
      }}
    >
      {/* Curtain accent bar */}
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${colors.accentDark}, ${colors.accent}, ${colors.accentLight}, #c084fc, ${colors.accentLight}, ${colors.accent}, ${colors.accentDark})`,
        }}
      />

      {/* Hero */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "5rem 2rem 2rem",
          textAlign: "center",
        }}
      >
        {/* Spotlight glow */}
        <div style={{ position: "relative", marginBottom: "1.5rem" }}>
          <div
            style={{
              position: "absolute",
              inset: "-80px -120px",
              background: `radial-gradient(ellipse at center, ${colors.accentGlow} 0%, transparent 65%)`,
              pointerEvents: "none",
            }}
          />
          <h1
            style={{
              position: "relative",
              fontSize: "clamp(3.5rem, 12vw, 7rem)",
              fontWeight: 900,
              letterSpacing: "-0.03em",
              margin: 0,
              lineHeight: 1,
              background: `linear-gradient(135deg, ${colors.accentLight} 0%, ${colors.accent} 45%, #c084fc 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            YesAInd
          </h1>
        </div>

        <p
          style={{
            fontSize: "clamp(1.05rem, 3vw, 1.35rem)",
            color: colors.textMuted,
            maxWidth: 460,
            lineHeight: 1.65,
            margin: "0 0 2.75rem",
          }}
        >
          Improv with AI. <span style={{ color: colors.text }}>You bring the ideas,</span> AI builds the stage.
        </p>

        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            justifyContent: "center",
            marginBottom: "0.75rem",
          }}
        >
          <button
            onClick={onStartImprov}
            style={{
              padding: "0.9rem 2.25rem",
              fontSize: "1.05rem",
              fontWeight: 700,
              background: colors.accent,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              letterSpacing: "0.015em",
              boxShadow: `0 0 28px ${colors.accentGlow}, 0 4px 16px rgba(0,0,0,0.4)`,
            }}
          >
            Start Improvising
          </button>
          <a
            href="#gallery"
            style={{
              padding: "0.9rem 2.25rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: colors.accentLight,
              background: colors.accentSubtle,
              border: `1px solid rgba(99,102,241,0.4)`,
              borderRadius: 8,
              textDecoration: "none",
              letterSpacing: "0.015em",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4em",
            }}
          >
            Watch the Gallery
          </a>
        </div>

        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: colors.textSubtle }}>
          No signup required to watch - just improvise
        </p>
      </main>

      {/* Feature cards */}
      <section
        style={{
          padding: "1rem 2rem 3rem",
          maxWidth: 920,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <p
          style={{
            textAlign: "center",
            fontSize: "0.75rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: colors.textSubtle,
            marginBottom: "1.25rem",
          }}
        >
          What's on stage
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "0.875rem",
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: "1.5rem 1.25rem",
                transition: "border-color 0.2s",
              }}
            >
              <div style={{ fontSize: "1.875rem", marginBottom: "0.875rem", lineHeight: 1 }}>{f.emoji}</div>
              <h3
                style={{
                  margin: "0 0 0.5rem",
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  color: colors.text,
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: colors.textMuted,
                  lineHeight: 1.65,
                }}
              >
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          padding: "1.25rem 2rem",
          textAlign: "center",
          borderTop: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
        }}
      >
        <span style={{ fontSize: "0.8rem", color: colors.textSubtle }}>YesAInd - multiplayer improv canvas</span>
        <a href="#privacy" style={{ fontSize: "0.8rem", color: colors.textSubtle, textDecoration: "none" }}>
          Privacy Policy
        </a>
      </footer>
    </div>
  );
}
