import { useState } from "react";
import type { AuthUser } from "../App";

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
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a2e", color: "#eee" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: 300, padding: "2rem", background: "#16213e", borderRadius: 8 }}>
        <h1 style={{ fontSize: "1.5rem", textAlign: "center", margin: 0 }}>CollabBoard</h1>
        <p style={{ textAlign: "center", color: "#888", fontSize: "0.875rem", margin: 0 }}>
          {mode === "login" ? "Sign in to continue" : "Create an account"}
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

        {error && <p style={{ color: "#f87171", fontSize: "0.875rem", margin: 0 }}>{error}</p>}

        <button type="submit" disabled={submitting} style={btnStyle}>
          {submitting ? "..." : mode === "login" ? "Sign In" : "Sign Up"}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
          style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: "0.875rem" }}
        >
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: 4,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#eee",
  fontSize: "1rem",
};

const btnStyle: React.CSSProperties = {
  padding: "0.5rem",
  borderRadius: 4,
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: "1rem",
  cursor: "pointer",
};
