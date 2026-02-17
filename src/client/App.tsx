import { useState, useEffect } from "react";
import { Board } from "./components/Board";
import { BoardList } from "./components/BoardList";
import { AuthForm } from "./components/AuthForm";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

function parseBoardId(): string | null {
  const match = location.hash.match(/^#board\/(.+)$/);
  return match ? match[1] : null;
}

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardId, setBoardId] = useState<string | null>(parseBoardId);

  // Sync boardId with hash changes (back/forward navigation)
  useEffect(() => {
    const onHashChange = () => setBoardId(parseBoardId());
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a2e", color: "#eee" }}>
        Loading...
      </div>
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
