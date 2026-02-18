import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "../App";
import { colors } from "../theme";

interface BoardMeta {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  unseen_count: number;
}

export function BoardList({ user, onSelectBoard, onLogout }: {
  user: AuthUser;
  onSelectBoard: (id: string) => void;
  onLogout: () => void;
}) {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBoards = useCallback((signal?: AbortSignal) => {
    return fetch("/api/boards", { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<BoardMeta[]>;
      })
      .then(setBoards)
      .catch(() => {
        // Only reset to empty on initial load (loading=true); preserve stale data on poll failures
        if (!signal?.aborted) setBoards((prev) => prev.length ? prev : []);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchBoards(controller.signal)
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    // Poll every 30s for activity badges
    const interval = setInterval(() => fetchBoards(), 30_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [fetchBoards]);

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
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text }}>
      {/* Header */}
      <div style={{
        height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", background: colors.overlayHeader, borderBottom: `1px solid ${colors.border}`,
        fontSize: "0.875rem",
      }}>
        <span style={{ fontWeight: 600 }}>CollabBoard</span>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <button onClick={() => { location.hash = "gallery"; }} style={{
            background: "none", border: `1px solid ${colors.borderLight}`, borderRadius: 4,
            color: colors.accentLight, padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.75rem",
          }}>
            Gallery
          </button>
          <span>{user.displayName}</span>
          <button onClick={handleLogout} style={{
            background: "none", border: `1px solid ${colors.borderLight}`, borderRadius: 4,
            color: colors.textMuted, padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.75rem",
          }}>
            Logout
          </button>
        </div>
      </div>

      {/* Board grid */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>Your Boards</h2>

        {loading ? (
          <p style={{ color: colors.textDim }}>Loading boards...</p>
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
                border: `2px dashed ${colors.borderLight}`, borderRadius: 8, padding: "1.5rem",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", minHeight: 120, color: colors.textMuted,
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
                  background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
                  padding: "1.5rem", cursor: "pointer", minHeight: 120,
                  display: "flex", flexDirection: "column", justifyContent: "space-between",
                  transition: "border-color 0.15s", position: "relative",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = colors.accentLight)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = colors.border)}
              >
                {/* Unseen activity badge */}
                {board.unseen_count > 0 && (
                  <div style={{
                    position: "absolute", top: -6, right: -6,
                    background: colors.accent, color: "#fff",
                    borderRadius: 10, minWidth: 20, height: 20,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.7rem", fontWeight: 700, padding: "0 5px",
                    boxShadow: `0 0 8px ${colors.accentGlow}`,
                  }}>
                    {board.unseen_count > 99 ? "99+" : board.unseen_count}
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{board.name}</div>
                  <div style={{ fontSize: "0.75rem", color: colors.textDim }}>
                    {new Date(board.updated_at + "Z").toLocaleDateString()}
                  </div>
                </div>
                {board.created_by !== "system" && (
                  <button
                    onClick={(e) => handleDelete(e, board.id)}
                    style={{
                      alignSelf: "flex-end", background: "none", border: `1px solid ${colors.borderLight}`,
                      borderRadius: 4, color: colors.error, padding: "0.2rem 0.5rem",
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
