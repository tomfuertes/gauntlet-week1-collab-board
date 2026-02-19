import { useState, useEffect } from "react";
import { Board } from "./components/Board";
import { BoardList } from "./components/BoardList";
import { AuthForm } from "./components/AuthForm";
import { ReplayViewer } from "./components/ReplayViewer";
import { SpectatorView } from "./components/SpectatorView";
import { SceneGallery } from "./components/SceneGallery";
import { colors } from "./theme";

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

function parseGallery(): boolean {
  return location.hash === "#gallery";
}

function PrivacyPolicy() {
  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, padding: "2rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <a href="#" style={{ color: colors.accentLight, fontSize: "0.875rem" }}>&larr; Back</a>
        <h1 style={{ fontSize: "1.5rem", marginTop: "1rem" }}>Privacy Policy</h1>
        <p style={{ color: colors.textMuted, lineHeight: 1.8 }}>
          CollabBoard stores only the data you provide: username, display name, and a hashed password.
          Board content (objects, positions, text) is stored in Cloudflare Durable Objects tied to each board.
          Session cookies are used for authentication and expire after 7 days.
        </p>
        <h2 style={{ fontSize: "1.125rem", marginTop: "1.5rem" }}>Data Collection</h2>
        <p style={{ color: colors.textMuted, lineHeight: 1.8 }}>
          We collect only what you explicitly provide. No analytics, tracking pixels, or third-party scripts are used.
          AI chat messages are processed server-side via Cloudflare Workers AI and are not stored beyond the session.
        </p>
        <h2 style={{ fontSize: "1.125rem", marginTop: "1.5rem" }}>Data Deletion</h2>
        <p style={{ color: colors.textMuted, lineHeight: 1.8 }}>
          You can delete your account and all associated data at any time via the account settings
          or by sending a DELETE request to <code style={{ color: colors.accentLight }}>/api/user</code>.
          This permanently removes your user record, sessions, and all boards you created.
        </p>
        <h2 style={{ fontSize: "1.125rem", marginTop: "1.5rem" }}>Contact</h2>
        <p style={{ color: colors.textMuted, lineHeight: 1.8 }}>
          For privacy inquiries, contact the project maintainer via the repository.
        </p>
      </div>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardId, setBoardId] = useState<string | null>(parseBoardId);
  const [replayId, setReplayId] = useState<string | null>(parseReplayId);
  const [watchId, setWatchId] = useState<string | null>(parseWatchId);
  const [showGallery, setShowGallery] = useState(parseGallery);

  // Sync boardId/replayId with hash changes (back/forward navigation)
  useEffect(() => {
    const onHashChange = () => {
      setBoardId(parseBoardId());
      setReplayId(parseReplayId());
      setWatchId(parseWatchId());
      setShowGallery(parseGallery());
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: colors.bg, color: colors.text }}>
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
        onBack={() => { location.hash = ""; setReplayId(null); }}
      />
    );
  }

  // Live spectator view is public - before auth gate
  if (watchId) {
    return (
      <SpectatorView
        key={watchId}
        boardId={watchId}
        onBack={() => { location.hash = ""; setWatchId(null); }}
      />
    );
  }

  // Gallery is public - before auth gate
  if (showGallery) {
    return (
      <SceneGallery
        onBack={() => { location.hash = ""; setShowGallery(false); }}
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
        onBack={() => { location.hash = ""; setBoardId(null); }}
      />
    );
  }

  return (
    <BoardList
      user={user}
      onSelectBoard={(id) => { location.hash = `board/${id}`; setBoardId(id); }}
      onLogout={() => setUser(null)}
    />
  );
}
