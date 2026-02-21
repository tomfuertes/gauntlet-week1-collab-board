import { useState, useEffect, useRef, useCallback } from "react";
import { Stage, Layer } from "react-konva";
import { AI_USER_ID } from "@shared/types";
import { useSpectatorSocket } from "../hooks/useSpectatorSocket";
import { colors } from "../theme";
import { Button } from "./Button";
import { BoardObjectRenderer } from "./BoardObjectRenderer";
import { Cursors } from "./Cursors";
import { BoardGrid } from "./BoardGrid";
import { AudienceRow } from "./AudienceRow";
import { CanvasSpeechBubbles } from "./CanvasSpeechBubbles";
import { WaveEffect, useWaveEffect, getWaveContainerClass, waveNeedsOverlay } from "./WaveEffect";
import "../styles/animations.css";

const HECKLE_COST = 5;
const HECKLE_COOLDOWN_MS = 120_000; // 2 minutes

// clap, laugh, fire, heart, wow, theater masks
const REACTION_EMOJIS = [
  "\uD83D\uDC4F",
  "\uD83D\uDE02",
  "\uD83D\uDD25",
  "\u2764\uFE0F",
  "\uD83D\uDE2E",
  "\uD83C\uDFAD",
] as const;
const HEADER_H = 48;
const REACTION_BAR_H = 56;

interface SpectatorViewProps {
  boardId: string;
  onBack: () => void;
}

export function SpectatorView({ boardId, onBack }: SpectatorViewProps) {
  const {
    connectionState,
    initialized,
    cursors,
    objects,
    presence,
    spectatorCount,
    reactions,
    canvasBubbles,
    audienceWave,
    clearAudienceWave,
    activePoll,
    pollResult,
    clearPollResult,
    sendCursor,
    sendReaction,
    sendHeckle,
    sendVote,
  } = useSpectatorSocket(boardId);
  const { activeWave, dismissWave } = useWaveEffect(audienceWave, clearAudienceWave);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  // Poll state: track per-poll vote and countdown
  const [votedOptionId, setVotedOptionId] = useState<string | null>(null);
  const [pollCountdown, setPollCountdown] = useState(0);
  const lastCursorSend = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);

  // Heckler mode: local reaction count + cooldown (mirrors server attachment)
  const [reactionCount, setReactionCount] = useState(0);
  const [lastHeckleAt, setLastHeckleAt] = useState(0);
  const [showHeckleInput, setShowHeckleInput] = useState(false);
  const [heckleText, setHeckleText] = useState("");
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const heckleInputRef = useRef<HTMLInputElement>(null);

  // Tick down cooldown display every second
  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, HECKLE_COOLDOWN_MS - (Date.now() - lastHeckleAt));
      setCooldownRemaining(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [lastHeckleAt]);

  // Poll countdown: tick every second while poll is active
  useEffect(() => {
    if (!activePoll) return;
    const id = setInterval(() => {
      setPollCountdown(Math.max(0, Math.ceil((activePoll.expiresAt - Date.now()) / 1000)));
    }, 200);
    setPollCountdown(Math.max(0, Math.ceil((activePoll.expiresAt - Date.now()) / 1000)));
    return () => clearInterval(id);
  }, [activePoll]);

  // Reset vote state on new poll
  useEffect(() => {
    if (activePoll) setVotedOptionId(null);
  }, [activePoll?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss poll result after 5s
  useEffect(() => {
    if (!pollResult) return;
    const id = setTimeout(clearPollResult, 5000);
    return () => clearTimeout(id);
  }, [pollResult, clearPollResult]);

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const stageH = size.height - HEADER_H - REACTION_BAR_H;

  // Pan via scroll, zoom via ctrl+scroll (same as Board.tsx)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(5, Math.max(0.1, scale * zoomFactor));
        const pointer = { x: e.clientX, y: e.clientY - HEADER_H };
        const newPos = {
          x: pointer.x - (pointer.x - stagePos.x) * (newScale / scale),
          y: pointer.y - (pointer.y - stagePos.y) * (newScale / scale),
        };
        setScale(newScale);
        setStagePos(newPos);
      } else {
        setStagePos((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    },
    [scale, stagePos],
  );

  // Send cursor position to server (throttled at ~30fps)
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const now = performance.now();
      if (now - lastCursorSend.current < 33) return;
      lastCursorSend.current = now;
      // Convert screen coords to canvas coords
      const canvasX = (e.clientX - stagePos.x) / scale;
      const canvasY = (e.clientY - HEADER_H - stagePos.y) / scale;
      sendCursor(canvasX, canvasY);
    },
    [scale, stagePos, sendCursor],
  );

  const handleReaction = useCallback(
    (emoji: string) => {
      // Place reaction at center of viewport in canvas coords
      const canvasX = (size.width / 2 - stagePos.x) / scale;
      const canvasY = (stageH / 2 - stagePos.y) / scale;
      sendReaction(emoji, canvasX, canvasY);
      // Optimistic: track local reaction count for heckle budget display
      setReactionCount((c) => c + 1);
    },
    [size.width, stageH, scale, stagePos, sendReaction],
  );

  const handleHeckleSubmit = useCallback(() => {
    const text = heckleText.trim();
    if (!text || reactionCount < HECKLE_COST || cooldownRemaining > 0) return;
    sendHeckle(text);
    // Optimistic: deduct cost and start cooldown
    setReactionCount((c) => c - HECKLE_COST);
    setLastHeckleAt(Date.now());
    setHeckleText("");
    setShowHeckleInput(false);
  }, [heckleText, reactionCount, cooldownRemaining, sendHeckle]);

  const objectList = [...objects.values()];

  return (
    <div
      className={getWaveContainerClass(activeWave) || undefined}
      style={{
        height: "100vh",
        background: colors.bg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          height: HEADER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          color: colors.text,
          fontSize: "0.875rem",
          background: colors.overlayHeader,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Button variant="link" onClick={onBack} style={{ color: colors.textMuted, fontSize: "0.875rem" }}>
            &larr; Back
          </Button>
          <span style={{ fontWeight: 600 }}>Live View</span>
          <span
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              color: "#f87171",
              fontSize: "0.625rem",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            LIVE
          </span>
          <span
            data-testid="connection-state"
            data-state={connectionState}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              display: "inline-block",
              background: {
                connected: colors.success,
                reconnecting: colors.warning,
                connecting: colors.info,
                disconnected: colors.error,
                failed: colors.error,
              }[connectionState],
            }}
            title={connectionState}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Presence avatars (players only) */}
          <div style={{ display: "flex", gap: 4 }}>
            {presence.map((p) => {
              const isAi = p.id === AI_USER_ID;
              return (
                <span
                  key={p.id}
                  style={{
                    background: isAi ? colors.aiCursor : colors.accent,
                    borderRadius: "50%",
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.625rem",
                    fontWeight: 600,
                    color: "#fff",
                  }}
                  title={p.username}
                >
                  {isAi ? "AI" : p.username[0].toUpperCase()}
                </span>
              );
            })}
          </div>
          {/* Spectator count */}
          {spectatorCount > 0 && (
            <span style={{ color: colors.textDim, fontSize: "0.75rem" }}>{spectatorCount} watching</span>
          )}
          <span style={{ color: colors.textDim }}>{Math.round(scale * 100)}%</span>
          <Button
            onClick={() => {
              navigator.clipboard
                .writeText(`${location.origin}/#watch/${boardId}`)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => {
                  /* clipboard blocked (unfocused, HTTP, etc.) */
                });
            }}
          >
            {copied ? "Copied!" : "Share Link"}
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={stageRef}
        style={{ flex: 1, overflow: "hidden", position: "relative", cursor: "default" }}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
      >
        {/* Loading skeleton */}
        {!initialized && connectionState !== "disconnected" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 5,
              pointerEvents: "none",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.06)",
                      animation: `cb-pulse 1.5s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.875rem" }}>Connecting to live board...</div>
            </div>
          </div>
        )}

        {/* Disconnected state */}
        {connectionState === "disconnected" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 5,
            }}
          >
            <div style={{ textAlign: "center", color: colors.textMuted }}>
              <div style={{ fontSize: "1.25rem", marginBottom: 8 }}>Board unavailable</div>
              <Button onClick={onBack} style={{ padding: "0.5rem 1rem" }}>
                Back
              </Button>
            </div>
          </div>
        )}

        <Stage width={size.width} height={stageH} scaleX={scale} scaleY={scale} x={stagePos.x} y={stagePos.y}>
          <Layer>
            <BoardGrid size={{ width: size.width, height: stageH }} scale={scale} stagePos={stagePos} />
            {objectList.map((obj) => (
              <BoardObjectRenderer key={obj.id} obj={obj} />
            ))}
            <Cursors cursors={cursors} />
          </Layer>
          {/* Audience silhouettes - always show 3 ghost seats, more when spectators present */}
          <AudienceRow spectatorCount={spectatorCount} />
        </Stage>

        {/* Floating reactions overlay */}
        {reactions.map((r) => {
          // Convert canvas coords back to screen coords
          const screenX = r.x * scale + stagePos.x;
          const screenY = r.y * scale + stagePos.y;
          return (
            <span key={r.id} className="cb-reaction" style={{ left: screenX, top: screenY }}>
              {r.emoji}
            </span>
          );
        })}

        {/* Canvas speech bubbles - heckles above audience seats + performer chat on stage */}
        <CanvasSpeechBubbles
          bubbles={canvasBubbles}
          spectatorCount={spectatorCount}
          scale={scale}
          stagePos={stagePos}
          headerH={0}
        />

        {/* Audience wave overlay effects (confetti/hearts/spotlight/dramatic) */}
        {activeWave && waveNeedsOverlay(activeWave.effect) && (
          <WaveEffect
            key={activeWave.key}
            effect={activeWave.effect}
            emoji={activeWave.emoji}
            count={activeWave.count}
            onDone={dismissWave}
          />
        )}

        {/* Audience poll overlay - voting phase */}
        {activePoll && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.55)",
              zIndex: 20,
              pointerEvents: "all",
            }}
          >
            <div
              style={{
                background: "#0f172a",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 16,
                padding: "28px 32px",
                maxWidth: 420,
                width: "90%",
                boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
              }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}
              >
                <div
                  style={{
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    fontSize: "0.65rem",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.35)",
                  }}
                >
                  Audience Poll
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    color: pollCountdown <= 5 ? "#f87171" : "#fbbf24",
                    transition: "color 0.3s",
                  }}
                >
                  {pollCountdown}s
                </div>
              </div>
              <div
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: "clamp(1rem, 3vw, 1.2rem)",
                  fontWeight: 600,
                  color: "#f1f5f9",
                  marginBottom: 20,
                  lineHeight: 1.4,
                }}
              >
                {activePoll.question}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {activePoll.options.map((opt) => {
                  const isVoted = votedOptionId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        if (!votedOptionId) {
                          setVotedOptionId(opt.id);
                          sendVote(activePoll.id, opt.id);
                        }
                      }}
                      disabled={!!votedOptionId}
                      style={{
                        background: isVoted ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.05)",
                        border: `1px solid ${isVoted ? "rgba(251,191,36,0.6)" : "rgba(255,255,255,0.12)"}`,
                        borderRadius: 10,
                        color: isVoted ? "#fbbf24" : "#e2e8f0",
                        padding: "10px 16px",
                        fontSize: "0.875rem",
                        textAlign: "left",
                        cursor: votedOptionId ? "default" : "pointer",
                        transition: "background 0.15s, border-color 0.15s",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      {isVoted && <span style={{ fontSize: "0.75rem" }}>✓</span>}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {votedOptionId && (
                <div
                  style={{ marginTop: 14, fontSize: "0.75rem", color: "rgba(255,255,255,0.3)", textAlign: "center" }}
                >
                  Vote recorded - waiting for results...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Audience poll result overlay (auto-dismisses in 5s, tap to dismiss early) */}
        {pollResult && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.55)",
              zIndex: 20,
              pointerEvents: "all",
            }}
            onClick={clearPollResult}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#0f172a",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 16,
                padding: "28px 32px",
                maxWidth: 420,
                width: "90%",
                boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
              }}
            >
              <div
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: "0.65rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.35)",
                  marginBottom: 12,
                }}
              >
                The Audience Has Spoken
              </div>
              <div
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: 6,
                }}
              >
                {pollResult.question}
              </div>
              <div
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: "clamp(1.1rem, 3vw, 1.4rem)",
                  fontWeight: 700,
                  color: "#fbbf24",
                  marginBottom: 20,
                }}
              >
                {pollResult.winner.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pollResult.options
                  .slice()
                  .sort((a, b) => (pollResult.votes[b.id] ?? 0) - (pollResult.votes[a.id] ?? 0))
                  .map((opt) => {
                    const count = pollResult.votes[opt.id] ?? 0;
                    const pct = pollResult.totalVotes > 0 ? Math.round((count / pollResult.totalVotes) * 100) : 0;
                    const isWinner = opt.id === pollResult.winner.id;
                    return (
                      <div key={opt.id}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 4,
                            fontSize: "0.8rem",
                            color: isWinner ? "#fbbf24" : "rgba(255,255,255,0.5)",
                          }}
                        >
                          <span>{opt.label}</span>
                          <span>
                            {pct}% ({count})
                          </span>
                        </div>
                        <div
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            borderRadius: 4,
                            height: 6,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              background: isWinner ? "#fbbf24" : "rgba(255,255,255,0.25)",
                              height: "100%",
                              width: `${pct}%`,
                              borderRadius: 4,
                              transition: "width 0.5s ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div style={{ marginTop: 14, fontSize: "0.7rem", color: "rgba(255,255,255,0.2)", textAlign: "center" }}>
                {pollResult.totalVotes} vote{pollResult.totalVotes !== 1 ? "s" : ""} cast · tap to dismiss
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Heckle input (shown when active) */}
      {showHeckleInput && (
        <div
          style={{
            background: colors.overlayHeader,
            borderTop: `1px solid ${colors.border}`,
            padding: "0.5rem 1rem",
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
          }}
        >
          <input
            ref={heckleInputRef}
            value={heckleText}
            onChange={(e) => setHeckleText(e.target.value.slice(0, 100))}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleHeckleSubmit();
              if (e.key === "Escape") {
                setShowHeckleInput(false);
                setHeckleText("");
              }
            }}
            placeholder="Shout something at the stage..."
            maxLength={100}
            autoFocus
            style={{
              flex: 1,
              background: "#1e293b",
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              color: "#e2e8f0",
              padding: "0.375rem 0.625rem",
              fontSize: "0.8125rem",
              outline: "none",
            }}
          />
          <span style={{ color: colors.textDim, fontSize: "0.6875rem", whiteSpace: "nowrap" }}>
            {heckleText.length}/100
          </span>
          <Button onClick={handleHeckleSubmit} disabled={!heckleText.trim()}>
            Send
          </Button>
          <Button
            variant="link"
            onClick={() => {
              setShowHeckleInput(false);
              setHeckleText("");
            }}
            style={{ color: colors.textMuted, fontSize: "0.8125rem" }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Reaction bar */}
      <div
        style={{
          height: REACTION_BAR_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          background: colors.overlayHeader,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleReaction(emoji)}
            style={{
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              fontSize: "1.5rem",
              padding: "0.25rem 0.5rem",
              cursor: "pointer",
              transition: "transform 0.1s, border-color 0.1s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.2)";
              e.currentTarget.style.borderColor = colors.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.borderColor = colors.border;
            }}
          >
            {emoji}
          </button>
        ))}
        {/* Heckle button: costs 5 reactions, 2-min cooldown */}
        {(() => {
          const canHeckle = reactionCount >= HECKLE_COST && cooldownRemaining === 0;
          const cooldownSec = Math.ceil(cooldownRemaining / 1000);
          return (
            <button
              onClick={() => {
                if (canHeckle) {
                  setShowHeckleInput((prev) => !prev);
                  if (!showHeckleInput) setTimeout(() => heckleInputRef.current?.focus(), 50);
                }
              }}
              disabled={!canHeckle}
              title={
                cooldownRemaining > 0
                  ? `Cooldown: ${cooldownSec}s`
                  : reactionCount < HECKLE_COST
                    ? `React ${HECKLE_COST - reactionCount} more times to unlock heckle`
                    : "Spend 5 reactions to heckle the scene!"
              }
              style={{
                background: canHeckle ? "rgba(251, 191, 36, 0.12)" : "none",
                border: `1px solid ${canHeckle ? "rgba(251, 191, 36, 0.5)" : colors.border}`,
                borderRadius: 8,
                fontSize: "1rem",
                padding: "0.25rem 0.625rem",
                cursor: canHeckle ? "pointer" : "default",
                opacity: canHeckle ? 1 : 0.4,
                color: canHeckle ? "#fbbf24" : colors.textDim,
                transition: "opacity 0.2s, border-color 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                whiteSpace: "nowrap",
              }}
            >
              📣
              {cooldownRemaining > 0 ? (
                <span style={{ fontSize: "0.625rem" }}>{cooldownSec}s</span>
              ) : (
                <span style={{ fontSize: "0.6875rem" }}>
                  {reactionCount}/{HECKLE_COST}
                </span>
              )}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
