import { useState, useEffect } from "react";
import type { AuthUser } from "../App";
import type { DailyChallenge, LeaderboardEntry } from "../../shared/types";
import { colors } from "../theme";
import { Button } from "./Button";

const MEDAL = ["🥇", "🥈", "🥉"];

export function LeaderboardPanel({ user, onBack }: { user: AuthUser | null; onBack: () => void }) {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState(false);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      // Fetch today's challenge first
      let challengeData: DailyChallenge | null = null;
      try {
        const r = await fetch("/api/challenges/today", { signal: ac.signal });
        if (!r.ok) throw new Error(`challenges/today returned ${r.status}`);
        challengeData = await r.json() as DailyChallenge;
        setChallenge(challengeData);
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error(JSON.stringify({ event: "leaderboard:challenge:fetch:error", error: String(err) }));
        return; // challenge load failed - show error state, skip leaderboard fetch
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }

      // Fetch leaderboard separately - failure shows distinct error, not misleading "no entries" empty state
      try {
        const lb = await fetch(`/api/challenges/${challengeData.id}/leaderboard`, { signal: ac.signal });
        if (!lb.ok) throw new Error(`leaderboard returned ${lb.status}`);
        setEntries(await lb.json() as LeaderboardEntry[]);
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error(JSON.stringify({ event: "leaderboard:entries:fetch:error", error: String(err) }));
        setLeaderboardError(true);
      }
    })();

    return () => ac.abort();
  }, []);

  const handleAccept = async () => {
    if (!challenge || !user) { location.hash = ""; return; }
    setEntering(true);
    try {
      const res = await fetch(`/api/challenges/${challenge.id}/enter`, { method: "POST" });
      if (!res.ok) {
        console.error(JSON.stringify({ event: "challenge:enter:error", status: res.status }));
        return;
      }
      const { boardId } = await res.json() as { boardId: string };
      location.hash = `board/${boardId}`;
    } catch (err) {
      console.error(JSON.stringify({ event: "challenge:enter:fetch:error", error: String(err) }));
    } finally {
      setEntering(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text }}>
      {/* Header */}
      <div style={{
        height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", background: colors.overlayHeader, borderBottom: `1px solid ${colors.border}`,
        fontSize: "0.875rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Button variant="link" onClick={onBack} style={{ color: colors.accentLight, fontSize: "0.875rem" }}>
            &larr; Back
          </Button>
          <span style={{ fontWeight: 600 }}>Daily Challenge</span>
        </div>
        {challenge && user && (
          <Button
            onClick={handleAccept}
            style={{
              background: challenge.userBoardId ? colors.success : colors.warning,
              color: "#000", fontWeight: 700, fontSize: "0.8125rem",
            }}
          >
            {entering ? "Starting..." : challenge.userBoardId ? "Continue Your Scene" : "Accept Challenge"}
          </Button>
        )}
        {challenge && !user && (
          <Button onClick={() => { location.hash = ""; }} style={{ fontSize: "0.8125rem" }}>
            Login to join
          </Button>
        )}
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
        {loading ? (
          <p style={{ color: colors.textDim }}>Loading...</p>
        ) : !challenge ? (
          <p style={{ color: colors.error }}>Failed to load today's challenge.</p>
        ) : (
          <>
            {/* Prompt banner */}
            <div style={{
              background: `linear-gradient(135deg, rgba(250, 204, 21, 0.08) 0%, rgba(251, 146, 60, 0.08) 100%)`,
              border: `1px solid rgba(250, 204, 21, 0.3)`, borderRadius: 8,
              padding: "1.25rem 1.5rem", marginBottom: "2rem",
            }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: colors.warning, letterSpacing: "0.05em", marginBottom: 6 }}>
                🎩 TODAY'S SCENE PROMPT
              </div>
              <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>{challenge.prompt}</div>
              <div style={{ fontSize: "0.75rem", color: colors.textMuted, marginTop: 6 }}>
                {new Date(challenge.date + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </div>
            </div>

            {/* Leaderboard */}
            <h2 style={{ fontSize: "1rem", fontWeight: 600, color: colors.textMuted, marginBottom: "1rem", letterSpacing: "0.05em" }}>
              LEADERBOARD
            </h2>

            {leaderboardError ? (
              <div style={{
                textAlign: "center", padding: "3rem", color: colors.error,
                border: `1px dashed ${colors.borderLight}`, borderRadius: 8,
              }}>
                Could not load leaderboard. Try refreshing the page.
              </div>
            ) : entries.length === 0 ? (
              <div style={{
                textAlign: "center", padding: "3rem", color: colors.textDim,
                border: `1px dashed ${colors.borderLight}`, borderRadius: 8,
              }}>
                No entries yet - be the first to accept today's challenge!
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {entries.map((entry, i) => {
                  // Compare by userId (stable) not displayName (mutable, non-unique)
                  const isCurrentUser = user?.id === entry.userId;
                  return (
                    <div key={entry.boardId} style={{
                      display: "flex", alignItems: "center", gap: "1rem",
                      background: isCurrentUser ? `rgba(99, 102, 241, 0.12)` : colors.surface,
                      border: `1px solid ${isCurrentUser ? colors.accentLight : colors.border}`,
                      borderRadius: 8, padding: "0.75rem 1rem",
                    }}>
                      {/* Rank - array is ordered by reactionCount DESC server-side */}
                      <div style={{ width: 32, textAlign: "center", fontSize: "1.125rem", flexShrink: 0 }}>
                        {i < 3 ? MEDAL[i] : <span style={{ color: colors.textDim, fontSize: "0.875rem" }}>#{i + 1}</span>}
                      </div>
                      {/* Username */}
                      <div style={{ flex: 1, fontWeight: isCurrentUser ? 700 : 400 }}>
                        {entry.username}
                        {isCurrentUser && (
                          <span style={{ marginLeft: 6, fontSize: "0.7rem", color: colors.accentLight, fontWeight: 400 }}>you</span>
                        )}
                      </div>
                      {/* Reaction count */}
                      <div style={{ color: colors.textMuted, fontSize: "0.875rem", display: "flex", alignItems: "center", gap: 4 }}>
                        <span>👏</span>
                        <span>{entry.reactionCount}</span>
                      </div>
                      {/* Links */}
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <Button
                          variant="link"
                          onClick={(e) => { e.stopPropagation(); location.hash = `watch/${entry.boardId}`; }}
                          style={{ fontSize: "0.75rem", color: colors.accentLight }}
                        >
                          Watch
                        </Button>
                        <Button
                          variant="link"
                          onClick={(e) => { e.stopPropagation(); location.hash = `replay/${entry.boardId}`; }}
                          style={{ fontSize: "0.75rem", color: colors.textMuted }}
                        >
                          Replay
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
