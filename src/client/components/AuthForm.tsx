import { useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { AuthUser } from "../App";
import { colors } from "../theme";
import { Button } from "./Button";
import { TextInput } from "./TextInput";

// ------------------------------------------------------------------
// Password form (unchanged UX - login + signup mode)
// ------------------------------------------------------------------
function PasswordSection({ onAuth, onBack }: { onAuth: (u: AuthUser) => void; onBack: (() => void) | null }) {
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
      const data = (await res.json()) as { user?: AuthUser; error?: string };
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
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {onBack && (
        <Button
          variant="link"
          type="button"
          onClick={onBack}
          style={{ color: colors.textMuted, fontSize: "0.8rem", textAlign: "left", marginBottom: 4 }}
        >
          ← Back to passkey sign-in
        </Button>
      )}
      <h2 style={{ fontSize: "1.25rem", textAlign: "center", margin: 0, fontWeight: 600 }}>
        {mode === "login" ? "Welcome back" : "Get started"}
      </h2>
      <p style={{ textAlign: "center", color: colors.textDim, fontSize: "0.875rem", margin: 0 }}>
        {mode === "login" ? "Sign in with password" : "Create a new account"}
      </p>

      <TextInput
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        autoComplete="username"
      />
      {mode === "signup" && (
        <TextInput
          type="text"
          placeholder="Display name (optional)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      )}
      <TextInput
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />

      {error && <p style={{ color: colors.error, fontSize: "0.875rem", margin: 0 }}>{error}</p>}

      <Button
        variant="primary"
        size="md"
        type="submit"
        disabled={submitting}
        style={{ borderRadius: 6, fontSize: "1rem", fontWeight: 600 }}
      >
        {submitting ? "..." : mode === "login" ? "Sign In" : "Sign Up"}
      </Button>

      <Button
        variant="link"
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setError("");
        }}
        style={{ color: colors.accentLight, fontSize: "0.875rem" }}
      >
        {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------
// Passkey login panel
// ------------------------------------------------------------------
function PasskeyLoginSection({
  onAuth,
  onRegister,
  onPasswordFallback,
}: {
  onAuth: (u: AuthUser) => void;
  onRegister: () => void;
  onPasswordFallback: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePasskeyLogin() {
    setError(null);
    setLoading(true);
    try {
      const optRes = await fetch("/auth/passkey/login/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!optRes.ok) throw new Error("Failed to get login options");
      const optData = (await optRes.json()) as PublicKeyCredentialRequestOptionsJSON & { _sessionKey: string };
      const { _sessionKey: sessionKey, ...browserOptions } = optData;

      const credential = await startAuthentication({ optionsJSON: browserOptions });

      const verifyRes = await fetch("/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, credential }),
      });
      const verifyData = (await verifyRes.json()) as { user?: AuthUser; error?: string };
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Authentication failed");
      onAuth(verifyData.user!);
    } catch (err) {
      // NotAllowedError = user canceled the dialog - don't show error
      if (err instanceof Error && err.name === "NotAllowedError") return;
      setError(err instanceof Error ? err.message : "Passkey sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <h2 style={{ fontSize: "1.25rem", textAlign: "center", margin: 0, fontWeight: 600 }}>Welcome</h2>
      <p style={{ textAlign: "center", color: colors.textDim, fontSize: "0.875rem", margin: 0 }}>
        Sign in with your passkey
      </p>

      {/* Primary passkey sign-in CTA */}
      <Button
        variant="primary"
        size="md"
        onClick={handlePasskeyLogin}
        disabled={loading}
        style={{
          borderRadius: 6,
          fontSize: "1rem",
          fontWeight: 600,
          padding: "0.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <span>🔑</span>
        {loading ? "Waiting for passkey..." : "Sign in with Passkey"}
      </Button>

      {error && <p style={{ color: colors.error, fontSize: "0.875rem", margin: 0 }}>{error}</p>}

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
        <span style={{ color: colors.textMuted, fontSize: "0.75rem" }}>or</span>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
      </div>

      <Button variant="secondary" size="md" onClick={onRegister} style={{ borderRadius: 6, fontSize: "0.9rem" }}>
        🔑 Register with a passkey
      </Button>

      <Button
        variant="link"
        type="button"
        onClick={onPasswordFallback}
        style={{ color: colors.textMuted, fontSize: "0.8125rem", marginTop: 4 }}
      >
        Use password instead
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------
// Passkey registration panel
// ------------------------------------------------------------------
function PasskeyRegisterSection({
  onAuth,
  onBack,
  onPasswordFallback,
}: {
  onAuth: (u: AuthUser) => void;
  onBack: () => void;
  onPasswordFallback: () => void;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!username || username.length < 2) return;
    setError(null);
    setLoading(true);
    try {
      const optRes = await fetch("/auth/passkey/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!optRes.ok) {
        const d = (await optRes.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to start registration");
      }
      const optData = (await optRes.json()) as PublicKeyCredentialCreationOptionsJSON;

      const credential = await startRegistration({ optionsJSON: optData });

      const verifyRes = await fetch("/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, credential }),
      });
      const verifyData = (await verifyRes.json()) as { user?: AuthUser; error?: string };
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Registration failed");
      onAuth(verifyData.user!);
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") return;
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <Button
        variant="link"
        type="button"
        onClick={onBack}
        style={{ color: colors.textMuted, fontSize: "0.8rem", textAlign: "left", marginBottom: 4 }}
      >
        ← Back
      </Button>
      <h2 style={{ fontSize: "1.25rem", textAlign: "center", margin: 0, fontWeight: 600 }}>Create account</h2>
      <p style={{ textAlign: "center", color: colors.textDim, fontSize: "0.875rem", margin: 0 }}>
        Choose a username - your device will create a passkey.
      </p>

      <TextInput
        type="text"
        placeholder="Username (2-30 chars)"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        minLength={2}
        maxLength={30}
        autoComplete="username"
        autoFocus
      />
      {error && <p style={{ color: colors.error, fontSize: "0.875rem", margin: 0 }}>{error}</p>}

      <Button
        variant="primary"
        size="md"
        type="submit"
        disabled={loading || username.length < 2}
        style={{ borderRadius: 6, fontSize: "1rem", fontWeight: 600 }}
      >
        {loading ? "Creating passkey..." : "🔑 Create passkey account"}
      </Button>

      <Button
        variant="link"
        type="button"
        onClick={onPasswordFallback}
        style={{ color: colors.textMuted, fontSize: "0.8125rem", marginTop: 4 }}
      >
        Use password instead
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------
// Root component
// ------------------------------------------------------------------
export function AuthForm({ onAuth }: { onAuth: (user: AuthUser) => void }) {
  // KEY-DECISION 2026-02-20: Feature-detect WebAuthn via PublicKeyCredential global.
  // Older browsers and some Android WebViews don't support it - fall straight to password.
  const supportsPasskeys = typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

  const [view, setView] = useState<"login" | "register" | "password">(supportsPasskeys ? "login" : "password");

  function rightPanel() {
    if (view === "password") {
      return <PasswordSection onAuth={onAuth} onBack={supportsPasskeys ? () => setView("login") : null} />;
    }
    if (view === "register") {
      return (
        <PasskeyRegisterSection
          onAuth={onAuth}
          onBack={() => setView("login")}
          onPasswordFallback={() => setView("password")}
        />
      );
    }
    return (
      <PasskeyLoginSection
        onAuth={onAuth}
        onRegister={() => setView("register")}
        onPasswordFallback={() => setView("password")}
      />
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: colors.bg, color: colors.text }}>
      {/* Left - Brand panel */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.bg} 100%)`,
          padding: "2rem",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <h1
          style={{
            fontSize: "2.5rem",
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.02em",
            position: "relative",
            zIndex: 1,
          }}
        >
          YesAInd
        </h1>
        <p
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: "1.1rem",
            marginTop: "0.75rem",
            textAlign: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          Real-time collaborative whiteboard
          <br />
          powered by AI
        </p>
        {/* Decorative dot grid echoing the canvas */}
        <div
          style={{
            marginTop: "2rem",
            display: "grid",
            gridTemplateColumns: "repeat(5, 6px)",
            gap: 16,
            opacity: 0.2,
            position: "relative",
            zIndex: 1,
          }}
        >
          {Array.from({ length: 25 }, (_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />
          ))}
        </div>
      </div>

      {/* Right - Form panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div
          style={{
            width: 320,
            padding: "2rem",
            background: colors.surface,
            borderRadius: 12,
            border: `1px solid ${colors.border}`,
          }}
        >
          {rightPanel()}
          <a
            href="#privacy"
            style={{
              display: "block",
              color: colors.textDim,
              fontSize: "0.75rem",
              textAlign: "center",
              textDecoration: "none",
              marginTop: "1rem",
            }}
          >
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
}
