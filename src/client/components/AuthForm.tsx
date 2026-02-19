import { useState } from "react";
import type { AuthUser } from "../App";
import { colors } from "../theme";

export function AuthForm({ onAuth }: { onAuth: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const body: Record<string, string> = { username, password };
      if (mode === "signup" && displayName) body.displayName = displayName;

      const res = await fetch(`/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json() as { user?: AuthUser; error?: string };
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      if (data.user) onAuth(data.user);
    } catch { // intentional: network failures shown to user via setError
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: colors.bg, color: colors.text }}>
      {/* Left - Brand panel */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.bg} 100%)`,
        padding: "2rem", position: "relative", overflow: "hidden",
      }}>
        <h1 style={{ fontSize: "2.5rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em", position: "relative", zIndex: 1 }}>
          CollabBoard
        </h1>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "1.1rem", marginTop: "0.75rem", textAlign: "center", position: "relative", zIndex: 1 }}>
          Real-time collaborative whiteboard
          <br />
          powered by AI
        </p>
        {/* Decorative dot grid echoing the canvas */}
        <div style={{ marginTop: "2rem", display: "grid", gridTemplateColumns: "repeat(5, 6px)", gap: 16, opacity: 0.2, position: "relative", zIndex: 1 }}>
          {Array.from({ length: 25 }, (_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />
          ))}
        </div>
      </div>

      {/* Right - Form panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <form onSubmit={handleSubmit} style={{
          display: "flex", flexDirection: "column", gap: "0.75rem",
          width: 320, padding: "2rem", background: colors.surface, borderRadius: 12,
          border: `1px solid ${colors.border}`,
        }}>
          <h2 style={{ fontSize: "1.25rem", textAlign: "center", margin: 0, fontWeight: 600 }}>
            {mode === "login" ? "Welcome back" : "Get started"}
          </h2>
          <p style={{ textAlign: "center", color: colors.textDim, fontSize: "0.875rem", margin: 0 }}>
            {mode === "login" ? "Sign in to your account" : "Create a new account"}
          </p>

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={inputStyle}
          />

          {mode === "signup" && (
            <input
              type="text"
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={inputStyle}
            />
          )}

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />

          {error && <p style={{ color: colors.error, fontSize: "0.875rem", margin: 0 }}>{error}</p>}

          <button type="submit" disabled={submitting} style={btnStyle}>
            {submitting ? "..." : mode === "login" ? "Sign In" : "Sign Up"}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            style={{ background: "none", border: "none", color: colors.accentLight, cursor: "pointer", fontSize: "0.875rem" }}
          >
            {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
          <a href="#privacy" style={{ color: colors.textDim, fontSize: "0.75rem", textAlign: "center", textDecoration: "none" }}>Privacy Policy</a>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  background: colors.surfaceAlt,
  color: colors.text,
  fontSize: "1rem",
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  padding: "0.6rem",
  borderRadius: 6,
  border: "none",
  background: colors.accent,
  color: "#fff",
  fontSize: "1rem",
  cursor: "pointer",
  fontWeight: 600,
  transition: "background 0.15s ease",
};
