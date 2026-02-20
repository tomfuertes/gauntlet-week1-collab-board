import React, { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import { colors, getUserColor } from "../theme";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { SCENE_TURN_BUDGET, DEFAULT_PERSONAS } from "../../shared/types";
import type { GameMode, Persona, AIModel } from "../../shared/types";
import "../styles/animations.css";
import { BOARD_TEMPLATES } from "../../shared/board-templates";
import type { ToolName } from "../../server/ai-tools-sdk";

interface ChatPanelProps {
  boardId: string;
  username?: string;
  gameMode?: GameMode;
  /** Workers AI model to use (desktop header selector; defaults to env WORKERS_AI_MODEL) */
  aiModel?: AIModel;
  onClose: () => void;
  initialPrompt?: string;
  selectedIds?: Set<string>;
  onAIComplete?: () => void;
  /** Mobile mode: fills parent instead of floating as absolute panel; larger touch targets */
  mobileMode?: boolean;
  /** The persona id this player has claimed as their improv partner (null = anyone/round-robin) */
  claimedPersonaId?: string | null;
  /** Callback to change the claimed persona (enables inline picker in header for Player B) */
  onClaimChange?: (personaId: string | null) => void;
}

// ---------------------------------------------------------------------------
// Tool display metadata (was ai-tool-meta.ts - only used here)
// ---------------------------------------------------------------------------

const TOOL_ICONS: Record<ToolName, string> = {
  createStickyNote: "\u{1F4CC}",
  createShape: "\u{1F7E6}",
  createFrame: "\u{1F5BC}",
  createConnector: "\u{27A1}",
  moveObject: "\u{1F4CD}",
  resizeObject: "\u{2194}",
  updateText: "\u{270F}",
  changeColor: "\u{1F3A8}",
  getBoardState: "\u{1F440}",
  deleteObject: "\u{1F5D1}",
  generateImage: "\u{2728}",
  batchExecute: "\u{26A1}",
};

const TOOL_LABELS: Record<ToolName, string> = {
  createStickyNote: "Creating sticky",
  createShape: "Creating shape",
  createFrame: "Creating frame",
  createConnector: "Connecting objects",
  moveObject: "Moving object",
  resizeObject: "Resizing object",
  updateText: "Updating text",
  changeColor: "Changing color",
  getBoardState: "Reading board",
  deleteObject: "Deleting object",
  generateImage: "Generating image",
  batchExecute: "Executing batch",
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name as ToolName] || "\u{1F527}";
}

function toolSummary(t: { name: string; args?: Record<string, unknown> }): string {
  const a = t.args || {};
  switch (t.name) {
    case "createStickyNote":
      return `Created sticky: "${a.text || "..."}"`;
    case "createShape":
      return `Drew ${a.shape || "shape"}${a.fill ? ` (${a.fill})` : ""}`;
    case "createFrame":
      return `Created frame: "${a.title || "..."}"`;
    case "createConnector":
      return "Connected objects";
    case "moveObject":
      return "Moved object";
    case "resizeObject":
      return "Resized object";
    case "updateText":
      return `Updated text: "${a.text || "..."}"`;
    case "changeColor":
      return `Changed color to ${a.color || "..."}`;
    case "getBoardState":
      return `Read board${a.filter ? ` (${a.filter}s)` : ""}`;
    case "deleteObject":
      return "Deleted object";
    case "generateImage":
      return `Generated image: "${a.prompt || "..."}"`;
    case "batchExecute": {
      const ops = a.operations as unknown[] | undefined;
      return `Batch: ${ops?.length ?? 0} operations`;
    }
    default:
      return TOOL_LABELS[t.name as ToolName] || t.name;
  }
}

// ---------------------------------------------------------------------------
// Dynamic intent chips - rotate based on conversation phase
// ---------------------------------------------------------------------------

interface IntentChip {
  prompt: string;
  category: "scene" | "character" | "chaos";
}

const SCENE_SET_INTENTS: IntentChip[] = [
  { prompt: "What happens next?", category: "scene" },
  { prompt: "A stranger walks in", category: "character" },
  { prompt: "Plot twist!", category: "scene" },
];

const MID_SCENE_INTENTS: IntentChip[] = [
  { prompt: "Complicate everything", category: "chaos" },
  { prompt: "Meanwhile, elsewhere...", category: "scene" },
  { prompt: "The stakes just got higher", category: "chaos" },
  { prompt: "A stranger walks in", category: "character" },
];

const DEEP_SCENE_INTENTS: IntentChip[] = [
  { prompt: "Plot twist!", category: "scene" },
  { prompt: "Meanwhile, elsewhere...", category: "scene" },
  { prompt: "Complicate everything", category: "chaos" },
  { prompt: "The stakes just got higher", category: "chaos" },
];

const CATEGORY_COLORS: Record<IntentChip["category"], string> = {
  scene: colors.accent,
  character: colors.warning,
  chaos: colors.error,
};

// Mode-specific intent chips
const HAT_INTENTS: IntentChip[] = [
  { prompt: "[NEXT-HAT-PROMPT]", category: "scene" },
  { prompt: "Plot twist!", category: "scene" },
  { prompt: "A stranger walks in", category: "character" },
];

const YESAND_INTENTS: IntentChip[] = [
  { prompt: "Yes, and...", category: "scene" },
  { prompt: "Escalate!", category: "chaos" },
  { prompt: "Meanwhile, elsewhere...", category: "scene" },
];

/** Pick intent chips based on user message count and game mode */
function getIntentChips(userMessageCount: number, gameMode?: GameMode): IntentChip[] {
  if (userMessageCount <= 0) return []; // empty state uses templates instead
  if (gameMode === "hat") return HAT_INTENTS;
  if (gameMode === "yesand") return YESAND_INTENTS;
  if (userMessageCount <= 2) return SCENE_SET_INTENTS;
  if (userMessageCount <= 5) return MID_SCENE_INTENTS;
  return DEEP_SCENE_INTENTS;
}

function ChipButton({
  label,
  color,
  borderRadius,
  disabled,
  mobile,
  onClick,
}: {
  label: string;
  color: string;
  borderRadius: number;
  disabled: boolean;
  mobile?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none",
        border: `1px solid ${color}44`,
        borderRadius,
        // 44px minimum touch target on mobile (Apple HIG)
        padding: mobile ? "10px 14px" : "3px 10px",
        minHeight: mobile ? 44 : undefined,
        cursor: disabled ? "not-allowed" : "pointer",
        color,
        fontSize: "0.6875rem",
        whiteSpace: "nowrap",
        transition: "border-color 0.15s, background 0.15s, color 0.15s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.borderColor = color;
          e.currentTarget.style.background = `${color}18`;
          e.currentTarget.style.color = "#e2e8f0";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = `${color}44`;
        e.currentTarget.style.background = "none";
        e.currentTarget.style.color = color;
      }}
    >
      {label}
    </button>
  );
}

interface ToolCallDisplay {
  name: string;
  args?: Record<string, unknown>;
}

function ToolHistory({ tools }: { tools: ToolCallDisplay[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none",
          border: "none",
          color: "#64748b",
          cursor: "pointer",
          fontSize: "0.6875rem",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span
          style={{
            fontSize: "0.625rem",
            transition: "transform 0.15s",
            transform: open ? "rotate(90deg)" : "none",
          }}
        >
          ▶
        </span>
        {tools.length} action{tools.length > 1 ? "s" : ""}
      </button>
      {open && (
        <div
          style={{
            marginTop: 4,
            paddingLeft: 10,
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {tools.map((t, i) => (
            <span key={i} style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
              {getToolIcon(t.name)} {toolSummary(t)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Regex to extract [username] prefix from user messages for multiplayer attribution
const SENDER_RE = /^\[([^\]]+)\]\s*/;

const PERSONA_COLOR_PRESETS = ["#fb923c", "#4ade80", "#f87171", "#60a5fa", "#c084fc", "#fbbf24"];

export function ChatPanel({
  boardId,
  username,
  gameMode,
  aiModel,
  onClose,
  initialPrompt,
  selectedIds,
  onAIComplete,
  mobileMode = false,
  claimedPersonaId,
  onClaimChange,
}: ChatPanelProps) {
  const selectedIdsArray = useMemo(() => (selectedIds?.size ? [...selectedIds] : undefined), [selectedIds]);

  // One-shot intent from chip click - sent in body.intent for the next message only, then cleared.
  // Uses state (not ref) so useAgentChat's body ref updates before the send effect fires.
  const [pendingIntent, setPendingIntent] = useState<string | undefined>();

  // Persona management state
  const [personas, setPersonas] = useState<Persona[]>([...DEFAULT_PERSONAS]);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTrait, setNewTrait] = useState("");
  const [newColor, setNewColor] = useState(PERSONA_COLOR_PRESETS[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [isUsingDefaults, setIsUsingDefaults] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);

  // Dynamic color map from loaded personas
  const personaColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of personas) map[p.name] = p.color;
    return map;
  }, [personas]);

  // Fetch personas from API on mount
  useEffect(() => {
    refreshPersonas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const refreshPersonas = useCallback(() => {
    fetch(`/api/boards/${boardId}/personas`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) {
          console.warn(`[ChatPanel] persona load: ${r.status}`);
          return null;
        }
        return r.json() as Promise<Persona[] | null>;
      })
      .then((data) => {
        if (data && data.length > 0) {
          setPersonas(data);
          setIsUsingDefaults(false);
        } else {
          setPersonas([...DEFAULT_PERSONAS]);
          setIsUsingDefaults(true);
        }
      })
      .catch((err: unknown) => {
        console.warn("[ChatPanel] refreshPersonas failed, using defaults:", err);
      });
  }, [boardId]);

  const handleCreatePersona = useCallback(async () => {
    const name = newName.trim();
    const trait = newTrait.trim();
    if (!name || !trait || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const r = await fetch(`/api/boards/${boardId}/personas`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, trait, color: newColor }),
      });
      if (r.ok) {
        setNewName("");
        setNewTrait("");
        setNewColor(PERSONA_COLOR_PRESETS[0]);
        refreshPersonas();
      } else {
        const msg =
          r.status === 403
            ? "Only the board owner can add characters."
            : r.status === 401
              ? "Session expired. Please refresh the page."
              : `Failed to add character (${r.status}).`;
        setCreateError(msg);
        console.error(`[ChatPanel] handleCreatePersona: ${r.status}`);
      }
    } catch (err) {
      setCreateError("Network error. Check your connection and try again.");
      console.error("[ChatPanel] handleCreatePersona network error:", err);
    } finally {
      setIsCreating(false);
    }
  }, [boardId, newName, newTrait, newColor, isCreating, refreshPersonas]);

  const handleDeletePersona = useCallback(
    async (personaId: string) => {
      try {
        const r = await fetch(`/api/boards/${boardId}/personas/${personaId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!r.ok) {
          console.error(`[ChatPanel] handleDeletePersona: ${r.status}`);
        }
      } catch (err) {
        console.error("[ChatPanel] handleDeletePersona network error:", err);
      } finally {
        refreshPersonas(); // always refresh - shows current state regardless of delete result
      }
    },
    [boardId, refreshPersonas],
  );

  // Connect to ChatAgent DO instance named by boardId
  const agent = useAgent({ agent: "ChatAgent", name: boardId });

  const {
    messages: uiMessages,
    sendMessage: sdkSendMessage,
    status: sdkStatus,
    error: sdkError,
    clearHistory,
  } = useAgentChat({
    agent,
    body: {
      selectedIds: selectedIdsArray,
      username,
      gameMode,
      model: aiModel,
      personaId: claimedPersonaId ?? undefined,
      intent: pendingIntent,
    },
  });

  // Prefix [username] for multiplayer attribution in persisted history
  const sendMessage = useCallback(
    (text: string) => {
      const prefixed = username ? `[${username}] ${text}` : text;
      sdkSendMessage({ text: prefixed });
    },
    [sdkSendMessage, username],
  );

  // useAgentChat stores body in a ref updated synchronously during each render (bodyOptionRef.current = body).
  // Setting pendingIntent via useState triggers a re-render, which updates that ref before React flushes effects.
  // The effect then reads the already-updated ref when sendMessage constructs the HTTP body.
  // KEY-DECISION 2026-02-20: sendMessage fires BEFORE setPendingIntent(undefined) so the body ref
  // inside useAgentChat still holds intent at the moment the HTTP request is constructed.
  useEffect(() => {
    if (!pendingIntent) return;
    const intent = pendingIntent;
    try {
      sendMessage(intent);
      setPendingIntent(undefined); // clear after successful send
    } catch (err) {
      console.error("[ChatPanel] intent chip send failed:", err);
      setPendingIntent(undefined); // clear on error too - avoids retry loops
    }
  }, [pendingIntent, sendMessage]);

  const loading = sdkStatus === "streaming" || sdkStatus === "submitted";
  const error = sdkStatus === "error" ? sdkError?.message || "Something went wrong" : undefined;
  const status = sdkStatus === "submitted" ? "Thinking..." : sdkStatus === "streaming" ? "Responding..." : "";

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastHandledPrompt = useRef<string | undefined>(undefined);

  // Detect AI response completion (loading: true -> false) and notify parent
  const prevLoadingRef = useRef(false);
  const onAICompleteRef = useRef(onAIComplete);
  onAICompleteRef.current = onAIComplete;
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      onAICompleteRef.current?.();
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [uiMessages, loading, status]);

  // Auto-send initialPrompt when it changes (supports overlay + context menu)
  useEffect(() => {
    if (initialPrompt && initialPrompt !== lastHandledPrompt.current) {
      lastHandledPrompt.current = initialPrompt;
      sendMessage(initialPrompt);
    } else if (!initialPrompt) {
      inputRef.current?.focus();
    }
  }, [initialPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = () => {
    const text = inputRef.current?.value.trim();
    if (!text || loading) return;
    inputRef.current!.value = "";
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const userMessageCount = uiMessages.filter((m) => m.role === "user").length;
  const budgetPct = userMessageCount / SCENE_TURN_BUDGET;
  const isSceneOver = userMessageCount >= SCENE_TURN_BUDGET && !loading;
  const budgetLabel = budgetPct >= 0.8 ? "Finale" : budgetPct >= 0.6 ? "Act 3" : null;
  const budgetColor = budgetPct >= 0.8 ? "#f87171" : "#fbbf24";

  const containerStyle: React.CSSProperties = mobileMode
    ? {
        // Fills the flex parent provided by Board's mobile layout
        position: "relative",
        height: "100%",
        width: "100%",
        zIndex: 1,
        background: "rgba(15, 23, 42, 0.97)",
        borderTop: "1px solid #334155",
        display: "flex",
        flexDirection: "column",
        animation: "cb-mobile-chat-in 0.25s ease-out",
      }
    : {
        position: "absolute",
        // KEY-DECISION 2026-02-19: top:64 = 48px header + 16px gap; maxHeight caps at min(600px,50vh)
        // so the panel never overlaps the header and stays within a readable height range
        top: 64,
        right: 16,
        width: 360,
        maxHeight: "min(600px, 50vh)",
        zIndex: 30,
        background: "rgba(15, 23, 42, 0.97)",
        border: "1px solid #334155",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        animation: "cb-chat-slide-in 0.3s ease-out",
      };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          borderBottom: "1px solid #334155",
          flexShrink: 0,
          borderRadius: "12px 12px 0 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setShowPersonaModal(true)}
            title="Manage AI characters"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#e2e8f0",
              fontWeight: 600,
              fontSize: "0.875rem",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {personas.map((p, i) => (
              <React.Fragment key={p.id}>
                {i > 0 && <span style={{ color: "#475569" }}> & </span>}
                <span style={{ color: p.color }}>{p.name}</span>
              </React.Fragment>
            ))}
            <span style={{ color: "#475569", fontSize: "0.75rem", marginLeft: 2 }}>⚙</span>
          </button>
          {budgetLabel && (
            <span
              style={{
                fontSize: "0.625rem",
                fontWeight: 700,
                color: budgetColor,
                background: `${budgetColor}18`,
                border: `1px solid ${budgetColor}44`,
                borderRadius: 10,
                padding: "1px 8px",
                animation: budgetPct >= 0.8 ? "cb-pulse 2s ease-in-out infinite" : undefined,
              }}
            >
              {budgetLabel}
            </span>
          )}
          {gameMode === "hat" && (
            <span
              style={{
                fontSize: "0.6875rem",
                color: colors.warning,
                border: `1px solid ${colors.warning}44`,
                borderRadius: 8,
                padding: "1px 6px",
              }}
            >
              Hat
            </span>
          )}
          {gameMode === "yesand" && (
            <span
              style={{
                fontSize: "0.6875rem",
                color: colors.info,
                border: `1px solid ${colors.info}44`,
                borderRadius: 8,
                padding: "1px 6px",
              }}
            >
              Beat {Math.min(userMessageCount, 10)}/10
            </span>
          )}
        </div>
        {!mobileMode && (
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "1.25rem",
              lineHeight: 1,
              padding: "0.25rem",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Inline persona claim picker - shown for Player B who joins mid-scene without OnboardModal */}
      {onClaimChange && personas.length >= 2 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderBottom: `1px solid ${colors.border}`,
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.6875rem", color: colors.textMuted, flexShrink: 0 }}>Partner:</span>
          {/* "Anyone" pill */}
          <button
            onClick={() => onClaimChange(null)}
            style={{
              background: claimedPersonaId === null ? colors.accentSubtle : "transparent",
              border: `1px solid ${claimedPersonaId === null ? colors.accent : colors.border}`,
              borderRadius: 20,
              padding: "2px 10px",
              color: claimedPersonaId === null ? colors.text : colors.textMuted,
              fontSize: "0.6875rem",
              cursor: "pointer",
              transition: "border-color 0.15s, color 0.15s, background 0.15s",
            }}
          >
            Anyone
          </button>
          {personas.map((persona) => {
            const active = claimedPersonaId === persona.id;
            return (
              <button
                key={persona.id}
                onClick={() => onClaimChange(active ? null : persona.id)}
                style={{
                  background: active ? `${persona.color}18` : "transparent",
                  border: `1px solid ${active ? persona.color : colors.border}`,
                  borderRadius: 20,
                  padding: "2px 10px",
                  color: active ? colors.text : colors.textMuted,
                  fontSize: "0.6875rem",
                  cursor: "pointer",
                  transition: "border-color 0.15s, color 0.15s, background 0.15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ color: persona.color, fontSize: "0.5rem" }}>&#9679;</span>
                {persona.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {uiMessages.length === 0 && !loading && (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <div
              style={{
                color: "#64748b",
                fontSize: "0.8125rem",
                marginBottom: "1rem",
              }}
            >
              Pick a scene to get started, or type your own:
            </div>
          </div>
        )}
        {uiMessages.map((msg: UIMessage) => {
          // Extract [username] prefix from user messages for multiplayer attribution
          let sender: string | undefined;
          let displayText = "";
          const tools: ToolCallDisplay[] = [];

          for (const part of msg.parts) {
            if (part.type === "text") {
              displayText += part.text;
            } else if (isToolUIPart(part)) {
              tools.push({
                name: getToolName(part),
                args: part.input as Record<string, unknown>,
              });
            }
          }

          const match = displayText.match(SENDER_RE);
          if (match) {
            const extracted = match[1];
            // Accept known persona from color map, or all-caps name (handles custom personas
            // not yet loaded in colorMap when initial history renders before refreshPersonas completes)
            const looksLikePersona = /^[A-Z][A-Z0-9]*$/.test(extracted);
            if (msg.role === "user" || personaColorMap[extracted] || (msg.role === "assistant" && looksLikePersona)) {
              sender = extracted;
              // KEY-DECISION 2026-02-19: Global regex prefix strip, not single slice(). Multi-step
              // streamText produces [NAME] at start of each text part; slice only removed the first.
              displayText = displayText.replace(new RegExp(`\\[${extracted}\\]\\s*`, "g"), "").trim();
            }
          }

          const content = displayText || (tools.length > 0 ? "I performed the requested actions on the board." : "");

          const isMe = sender === username;
          const senderColor =
            msg.role === "assistant"
              ? (sender && personaColorMap[sender]) || colors.aiCursor
              : sender
                ? getUserColor(sender)
                : colors.accent;
          const senderLabel = msg.role === "assistant" ? (sender ?? "AI") : sender;

          // Skip empty assistant messages (no text, no tools) - avoids blank "AI" bubbles
          // from streaming artifacts or tool-only steps that produced no recognized parts
          if (msg.role === "assistant" && !content && tools.length === 0) {
            console.debug("[ChatPanel] suppressed empty assistant message", msg.id);
            return null;
          }

          return (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
              }}
            >
              {msg.role === "assistant" && tools.length > 0 && <ToolHistory tools={tools} />}
              {senderLabel && (
                <div
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    color: senderColor,
                    marginBottom: 2,
                    textAlign: msg.role === "user" ? "right" : "left",
                    paddingLeft: msg.role === "user" ? 0 : 4,
                    paddingRight: msg.role === "user" ? 4 : 0,
                  }}
                >
                  {isMe ? "You" : senderLabel}
                </div>
              )}
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  background: msg.role === "user" ? colors.accent : "#1e293b",
                  color: msg.role === "user" ? "#fff" : "#e2e8f0",
                  fontSize: "0.8125rem",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {content}
              </div>
            </div>
          );
        })}
        {loading && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "0.5rem 0.75rem",
              borderRadius: "12px 12px 12px 4px",
              background: "#1e293b",
              color: "#94a3b8",
              fontSize: "0.8125rem",
              display: "flex",
              alignItems: "center",
              gap: 4,
              minHeight: 24,
            }}
          >
            {!status || status === "Thinking..." ? (
              <span className="chat-bounce-dots">
                <span className="chat-dot" />
                <span className="chat-dot" />
                <span className="chat-dot" />
              </span>
            ) : (
              <span className="chat-pulse-text">{status}</span>
            )}
          </div>
        )}
        {error && !loading && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "0.5rem 0.75rem",
              borderRadius: "12px 12px 12px 4px",
              background: "rgba(248, 113, 113, 0.1)",
              color: colors.error,
              fontSize: "0.8125rem",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Chips bar: scene templates when empty, intent chips when in-scene */}
      {!isSceneOver && (
        <div
          style={{
            padding: mobileMode ? "0.5rem 0.75rem" : "0.375rem 0.75rem",
            // 44px min height for touch targets on mobile (Apple HIG)
            minHeight: mobileMode ? 44 : undefined,
            borderTop: "1px solid #1e293b",
            flexShrink: 0,
            display: "flex",
            gap: 6,
            overflowX: "auto",
            alignItems: "center",
          }}
        >
          {uiMessages.length === 0
            ? BOARD_TEMPLATES.map((t) => (
                <ChipButton
                  key={t.label}
                  label={t.label}
                  color={colors.textMuted}
                  borderRadius={6}
                  disabled={loading}
                  mobile={mobileMode}
                  onClick={() => sendMessage(t.prompt)}
                />
              ))
            : getIntentChips(userMessageCount, gameMode).map((chip) => (
                <ChipButton
                  key={chip.prompt}
                  label={chip.prompt === "[NEXT-HAT-PROMPT]" ? "Next prompt" : chip.prompt}
                  color={CATEGORY_COLORS[chip.category]}
                  borderRadius={16}
                  disabled={loading || isSceneOver}
                  mobile={mobileMode}
                  onClick={() => {
                    // Hat/yesand mode chips have no INTENT_PROMPTS server-side entry - send direct.
                    // Freeform chips route through pendingIntent so body.intent reaches the server.
                    if (gameMode === "hat" || gameMode === "yesand") {
                      sendMessage(chip.prompt);
                    } else {
                      setPendingIntent(chip.prompt);
                    }
                  }}
                />
              ))}
        </div>
      )}

      {/* Input / Scene complete */}
      {isSceneOver ? (
        <div
          style={{
            padding: "0.75rem",
            paddingBottom: mobileMode ? "max(0.75rem, env(safe-area-inset-bottom))" : "0.75rem",
            borderTop: "1px solid #334155",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            borderRadius: mobileMode ? 0 : "0 0 12px 12px",
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: "0.8125rem", fontWeight: 600 }}>Scene complete</span>
          <Button
            variant="primary"
            size="md"
            onClick={() => clearHistory()}
            style={{ borderRadius: 8, fontSize: "0.8125rem", fontWeight: 600 }}
          >
            New Scene
          </Button>
        </div>
      ) : (
        <div
          style={{
            padding: "0.75rem",
            // Safe-area-inset for notched phones (iOS home indicator, etc.)
            paddingBottom: mobileMode ? "max(0.75rem, env(safe-area-inset-bottom))" : "0.75rem",
            borderTop: "1px solid #334155",
            flexShrink: 0,
            display: "flex",
            gap: "0.5rem",
            borderRadius: mobileMode ? 0 : "0 0 12px 12px",
          }}
        >
          <textarea
            ref={inputRef}
            placeholder="Ask the AI..."
            onKeyDown={handleKeyDown}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "0.5rem 0.75rem",
              color: "#e2e8f0",
              fontSize: "0.8125rem",
              outline: "none",
              fontFamily: "inherit",
              maxHeight: 120,
              overflowY: "auto",
            }}
          />
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={loading}
            style={{
              background: loading ? colors.accentDark : colors.accent,
              borderRadius: 8,
              fontSize: "0.8125rem",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Send
          </Button>
        </div>
      )}

      {/* Persona management modal */}
      <Modal open={showPersonaModal} onClose={() => setShowPersonaModal(false)} width={400}>
        <div style={{ color: "#e2e8f0" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700 }}>AI Characters</h3>
          {isUsingDefaults && (
            <p
              style={{
                margin: "0 0 1rem",
                fontSize: "0.75rem",
                color: "#64748b",
              }}
            >
              Using default SPARK &amp; SAGE. Add custom characters to replace them for this board.
            </p>
          )}

          {/* Existing custom personas */}
          {!isUsingDefaults && (
            <div
              style={{
                marginBottom: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {personas.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#1e293b",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: p.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, color: p.color, minWidth: 60 }}>{p.name}</span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "#94a3b8",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.trait}
                  </span>
                  <button
                    onClick={() => handleDeletePersona(p.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      padding: "2px 4px",
                      flexShrink: 0,
                    }}
                    title="Delete character"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add character form */}
          <div style={{ borderTop: "1px solid #334155", paddingTop: "1rem" }}>
            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "#94a3b8",
              }}
            >
              Add Character
            </p>
            <div style={{ marginBottom: 8 }}>
              <input
                placeholder="Name (e.g. CHAOS)"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toUpperCase().slice(0, 20))}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  padding: "0.4rem 0.6rem",
                  color: "#e2e8f0",
                  fontSize: "0.8125rem",
                  outline: "none",
                }}
              />
            </div>
            <textarea
              placeholder="Personality (e.g. You are CHAOS, a reckless wildcard who ignores all rules...)"
              value={newTrait}
              onChange={(e) => setNewTrait(e.target.value.slice(0, 500))}
              rows={3}
              style={{
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "0.4rem 0.6rem",
                color: "#e2e8f0",
                fontSize: "0.8125rem",
                outline: "none",
                fontFamily: "inherit",
                marginBottom: 8,
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Color:</span>
              {PERSONA_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: c,
                    border: "none",
                    cursor: "pointer",
                    outline: newColor === c ? `2px solid ${c}` : "none",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={handleCreatePersona}
              disabled={!newName.trim() || !newTrait.trim() || isCreating}
              style={{ fontSize: "0.8125rem", fontWeight: 600, width: "100%" }}
            >
              {isCreating ? "Adding..." : "Add Character"}
            </Button>
            {createError && (
              <p
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "0.75rem",
                  color: "#f87171",
                }}
              >
                {createError}
              </p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
