import { useState, useEffect } from "react";
import { Board } from "./components/Board";
import { AuthForm } from "./components/AuthForm";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

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

  return <Board user={user} onLogout={() => setUser(null)} />;
}
