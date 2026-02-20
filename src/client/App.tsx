import { useState, useEffect, Component } from "react";
import type { CSSProperties, ReactNode, ErrorInfo } from "react";
import { Board } from "./components/Board";
import { BoardList } from "./components/BoardList";
import { AuthForm } from "./components/AuthForm";
import { ReplayViewer } from "./components/ReplayViewer";
import { SpectatorView } from "./components/SpectatorView";
import { LeaderboardPanel } from "./components/LeaderboardPanel";
import { colors } from "./theme";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: colors.bg,
          color: colors.text,
          gap: 16,
        }}
      >
        <h2>Something went wrong</h2>
        <pre style={{ color: colors.textMuted, fontSize: "0.875rem", maxWidth: 600, overflow: "auto" }}>
          {this.state.error.message}
        </pre>
        <button
          onClick={() => {
            this.setState({ error: null });
            location.hash = "";
          }}
          style={{
            padding: "8px 16px",
            background: colors.accent,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Back to home
        </button>
      </div>
    );
  }
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

function parseBoardId(): string | null {
  const match = location.hash.match(/^#board\/(.+)$/);
  return match ? match[1] : null;
}

function parseReplayId(): string | null {
  const match = location.hash.match(/^#replay\/(.+)$/);
  return match ? match[1] : null;
}

function parseWatchId(): string | null {
  const match = location.hash.match(/^#watch\/(.+)$/);
  return match ? match[1] : null;
}

function parseChallenge(): boolean {
  return location.hash === "#challenge";
}

function PrivacyPolicy() {
  const sectionHead: CSSProperties = {
    fontSize: "1.125rem",
    fontWeight: 600,
    marginTop: "1.5rem",
    marginBottom: "0.5rem",
  };
  const body: CSSProperties = { color: colors.textMuted, lineHeight: 1.8, margin: 0 };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, padding: "2rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <a href="#" style={{ color: colors.accentLight, fontSize: "0.875rem", textDecoration: "none" }}>
          &larr; Back
        </a>
        <h1 style={{ fontSize: "1.5rem", marginTop: "1rem", marginBottom: "0.25rem" }}>Privacy Policy</h1>
        <p style={{ color: colors.textSubtle, fontSize: "0.8125rem", margin: "0 0 1.5rem" }}>
          Last updated: February 2026
        </p>

        <h2 style={sectionHead}>Data We Collect</h2>
        <p style={body}>
          We collect only what you provide: username, display name, and either a PBKDF2-hashed password or a
          passkey/WebAuthn credential stored server-side. Board content (canvas objects, positions, text) is stored in
          Cloudflare Durable Objects and D1 database tied to your account.
        </p>

        <h2 style={sectionHead}>AI Data Flow</h2>
        <p style={body}>
          Chat messages are sent server-side to AI providers depending on the model you select: Anthropic (Claude),
          OpenAI, or Cloudflare Workers AI. None of these providers train on your data under their API terms. Messages
          are not stored beyond what is needed to maintain the conversation context in the current session.
        </p>

        <h2 style={sectionHead}>Cookies &amp; Tracking</h2>
        <p style={body}>
          We use a single session cookie for authentication only. It expires after 7 days. There are no tracking pixels,
          advertising cookies, or third-party analytics scripts. Langfuse is used for AI observability (latency, tool
          use) and processes no personally identifiable information.
        </p>

        <h2 style={sectionHead}>Public Content</h2>
        <p style={body}>
          Boards you mark public (or that appear in the community gallery) are intentionally visible to anyone via the
          gallery, replay, and spectator views - no account required. Content on public boards should be treated as
          publicly accessible.
        </p>

        <h2 style={sectionHead}>Data Storage</h2>
        <p style={body}>
          All data is stored on Cloudflare infrastructure (Durable Objects + D1 database) in the United States. No data
          is sold or shared with third parties beyond the AI providers listed above for the purpose of generating
          responses.
        </p>

        <h2 style={sectionHead}>Contact</h2>
        <p style={body}>
          For privacy questions, open an issue on the{" "}
          <a
            href="https://github.com/thomasfuertes/yesaind"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: colors.accentLight }}
          >
            GitHub repository
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardId, setBoardId] = useState<string | null>(parseBoardId);
  const [replayId, setReplayId] = useState<string | null>(parseReplayId);
  const [watchId, setWatchId] = useState<string | null>(parseWatchId);
  const [showChallenge, setShowChallenge] = useState(parseChallenge);

  // Sync boardId/replayId with hash changes (back/forward navigation)
  useEffect(() => {
    const onHashChange = () => {
      setBoardId(parseBoardId());
      setReplayId(parseReplayId());
      setWatchId(parseWatchId());
      setShowChallenge(parseChallenge());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    fetch("/auth/me")
      .then((r) => r.json() as Promise<{ user: AuthUser | null }>)
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: colors.bg,
          color: colors.text,
        }}
      >
        Loading...
      </div>
    );
  }

  if (location.hash === "#privacy") {
    return <PrivacyPolicy />;
  }

  // Replay is public - before auth gate
  if (replayId) {
    return (
      <ReplayViewer
        key={replayId}
        boardId={replayId}
        onBack={() => {
          location.hash = "";
          setReplayId(null);
        }}
      />
    );
  }

  // Live spectator view is public - before auth gate
  if (watchId) {
    return (
      <SpectatorView
        key={watchId}
        boardId={watchId}
        onBack={() => {
          location.hash = "";
          setWatchId(null);
        }}
      />
    );
  }

  // Challenge leaderboard is public - before auth gate (user may be null)
  if (showChallenge) {
    return (
      <LeaderboardPanel
        user={user}
        onBack={() => {
          location.hash = "";
          setShowChallenge(false);
        }}
      />
    );
  }

  if (!user) {
    return <AuthForm onAuth={setUser} />;
  }

  if (boardId) {
    return (
      <Board
        key={boardId}
        user={user}
        boardId={boardId}
        onLogout={() => setUser(null)}
        onBack={() => {
          location.hash = "";
          setBoardId(null);
        }}
      />
    );
  }

  return (
    <BoardList
      user={user}
      onSelectBoard={(id) => {
        location.hash = `board/${id}`;
        setBoardId(id);
      }}
      onLogout={() => setUser(null)}
    />
  );
}
