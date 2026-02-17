import { useState, useEffect } from "react";
import type { AuthUser } from "../App";
import { colors } from "../theme";

interface BoardMeta {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function BoardList({ user, onSelectBoard, onLogout }: {
  user: AuthUser;
  onSelectBoard: (id: string) => void;
  onLogout: () => void;
}) {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/boards", { signal: controller.signal })
      .then((r) => r.json() as Promise<BoardMeta[]>)
      .then(setBoards)
      .catch(() => { if (!controller.signal.aborted) setBoards([]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const handleCreate = async () => {
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const { id } = await res.json() as { id: string };
      onSelectBoard(id);
    }
  };

  const handleDelete = async (e: React.MouseEvent, boardId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this board? This cannot be undone.")) return;
    const res = await fetch(`/api/boards/${boardId}`, { method: "DELETE" });
    if (res.ok) {
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    }
  };

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", color: "#eee" }}>
      {/* Header */}
      <div style={{
        height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", background: "rgba(22, 33, 62, 0.9)", borderBottom: "1px solid #334155",
        fontSize: "0.875rem",
      }}>
        <span style={{ fontWeight: 600 }}>CollabBoard</span>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span>{user.displayName}</span>
          <button onClick={handleLogout} style={{
            background: "none", border: "1px solid #475569", borderRadius: 4,
            color: "#94a3b8", padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.75rem",
          }}>
            Logout
          </button>
        </div>
      </div>

      {/* Board grid */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>Your Boards</h2>

        {loading ? (
          <p style={{ color: "#888" }}>Loading boards...</p>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "1rem",
          }}>
            {/* New board card */}
            <div
              onClick={handleCreate}
              style={{
                border: "2px dashed #475569", borderRadius: 8, padding: "1.5rem",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", minHeight: 120, color: "#94a3b8",
                fontSize: "1rem", transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = colors.accentLight)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = colors.borderLight)}
            >
              + New Board
            </div>

            {/* Existing boards */}
            {boards.map((board) => (
              <div
                key={board.id}
                onClick={() => onSelectBoard(board.id)}
                style={{
                  background: "#16213e", border: "1px solid #334155", borderRadius: 8,
                  padding: "1.5rem", cursor: "pointer", minHeight: 120,
                  display: "flex", flexDirection: "column", justifyContent: "space-between",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = colors.accentLight)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = colors.border)}
              >
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{board.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>
                    {new Date(board.updated_at + "Z").toLocaleDateString()}
                  </div>
                </div>
                {board.created_by !== "system" && (
                  <button
                    onClick={(e) => handleDelete(e, board.id)}
                    style={{
                      alignSelf: "flex-end", background: "none", border: "1px solid #475569",
                      borderRadius: 4, color: "#f87171", padding: "0.2rem 0.5rem",
                      cursor: "pointer", fontSize: "0.7rem", marginTop: 8,
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
