import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "../App";
import type { DailyChallenge } from "../../shared/types";
import { colors } from "../theme";
import { Button } from "./Button";

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
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(true);
  const [enteringChallenge, setEnteringChallenge] = useState(false);

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

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/challenges/today", { signal: ac.signal })
      .then((r) => r.ok ? r.json() as Promise<DailyChallenge> : Promise.reject(r.status))
      .then(setChallenge)
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(JSON.stringify({ event: "challenge:today:fetch:error", error: String(err) }));
      })
      .finally(() => { if (!ac.signal.aborted) setChallengeLoading(false); });
    return () => ac.abort();
  }, []);

  const handleAcceptChallenge = async () => {
    if (!challenge) return;
    setEnteringChallenge(true);
    try {
      const res = await fetch(`/api/challenges/${challenge.id}/enter`, { method: "POST" });
      if (!res.ok) {
        console.error(JSON.stringify({ event: "challenge:enter:error", status: res.status }));
        return;
      }
      const { boardId } = await res.json() as { boardId: string };
      onSelectBoard(boardId);
    } catch (err) {
      console.error(JSON.stringify({ event: "challenge:enter:fetch:error", error: String(err) }));
    } finally {
      setEnteringChallenge(false);
    }
  };

  const handleCreate = async () => {
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const { id, name } = await res.json() as { id: string; name: string };
      // Optimistic update - avoids D1 read replication lag on re-fetch
      const now = new Date().toISOString().replace("T", " ").split(".")[0];
      setBoards((prev) => [{
        id, name, created_by: user.id,
        created_at: now, updated_at: now, unseen_count: 0,
      }, ...prev]);
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
          <Button onClick={() => { location.hash = "challenge"; }} style={{ color: colors.warning }}>
            Daily Challenge
          </Button>
          <Button onClick={() => { location.hash = "gallery"; }} style={{ color: colors.accentLight }}>
            Gallery
          </Button>
          <span>{user.displayName}</span>
          <Button onClick={handleLogout}>Logout</Button>
        </div>
      </div>

      {/* Board grid */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
        {/* Daily Challenge card */}
        {!challengeLoading && challenge && (
          <div style={{
            background: `linear-gradient(135deg, rgba(250, 204, 21, 0.08) 0%, rgba(251, 146, 60, 0.08) 100%)`,
            border: `1px solid rgba(250, 204, 21, 0.3)`,
            borderRadius: 8, padding: "1.25rem 1.5rem",
            marginBottom: "1.5rem", display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: "1rem",
            flexWrap: "wrap",
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: 4 }}>
                <span style={{ fontSize: "1rem" }}>🎩</span>
                <span style={{ fontWeight: 700, color: colors.warning, fontSize: "0.875rem", letterSpacing: "0.05em" }}>
                  TODAY'S DAILY CHALLENGE
                </span>
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: colors.text }}>
                {challenge.prompt}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexShrink: 0 }}>
              <Button
                variant="link"
                onClick={() => { location.hash = "challenge"; }}
                style={{ color: colors.textMuted, fontSize: "0.8125rem" }}
              >
                Leaderboard
              </Button>
              {challenge.userBoardId ? (
                <Button
                  onClick={() => onSelectBoard(challenge.userBoardId!)}
                  style={{ background: colors.success, color: "#000", fontWeight: 600 }}
                >
                  Continue Your Scene
                </Button>
              ) : (
                <Button
                  onClick={handleAcceptChallenge}
                  style={{ background: colors.warning, color: "#000", fontWeight: 700 }}
                >
                  {enteringChallenge ? "Starting..." : "Accept Challenge"}
                </Button>
              )}
            </div>
          </div>
        )}

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
                  <Button
                    variant="danger"
                    onClick={(e) => handleDelete(e, board.id)}
                    style={{ alignSelf: "flex-end", fontSize: "0.7rem", padding: "0.2rem 0.5rem", marginTop: 8 }}
                  >
                    Delete
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
