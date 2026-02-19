import React, { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import { colors, getUserColor } from "../theme";
import "../styles/animations.css";
import { BOARD_TEMPLATES } from "../../shared/board-templates";
import type { ToolName } from "../../server/ai-tools-sdk";

interface ChatPanelProps {
  boardId: string;
  username?: string;
  onClose: () => void;
  initialPrompt?: string;
  selectedIds?: Set<string>;
  onAIComplete?: () => void;
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
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name as ToolName] || "\u{1F527}";
}

function toolSummary(t: { name: string; args?: Record<string, unknown> }): string {
  const a = t.args || {};
  switch (t.name) {
    case "createStickyNote": return `Created sticky: "${a.text || "..."}"`;
    case "createShape": return `Drew ${a.shape || "shape"}${a.fill ? ` (${a.fill})` : ""}`;
    case "createFrame": return `Created frame: "${a.title || "..."}"`;
    case "createConnector": return "Connected objects";
    case "moveObject": return "Moved object";
    case "resizeObject": return "Resized object";
    case "updateText": return `Updated text: "${a.text || "..."}"`;
    case "changeColor": return `Changed color to ${a.color || "..."}`;
    case "getBoardState": return `Read board${a.filter ? ` (${a.filter}s)` : ""}`;
    case "deleteObject": return "Deleted object";
    case "generateImage": return `Generated image: "${a.prompt || "..."}"`;
    default: return TOOL_LABELS[t.name as ToolName] || t.name;
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

/** Pick intent chips based on user message count (excludes AI replies) */
function getIntentChips(userMessageCount: number): IntentChip[] {
  if (userMessageCount <= 0) return []; // empty state uses templates instead
  if (userMessageCount <= 2) return SCENE_SET_INTENTS;
  if (userMessageCount <= 5) return MID_SCENE_INTENTS;
  return DEEP_SCENE_INTENTS;
}

function ChipButton({ label, color, borderRadius, disabled, onClick }: {
  label: string;
  color: string;
  borderRadius: number;
  disabled: boolean;
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
        padding: "3px 10px",
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
          background: "none", border: "none", color: "#64748b", cursor: "pointer",
          fontSize: "0.6875rem", padding: 0, display: "flex", alignItems: "center", gap: 4,
        }}
      >
        <span style={{ fontSize: "0.625rem", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>
          ▶
        </span>
        {tools.length} action{tools.length > 1 ? "s" : ""}
      </button>
      {open && (
        <div style={{ marginTop: 4, paddingLeft: 10, display: "flex", flexDirection: "column", gap: 3 }}>
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

export function ChatPanel({ boardId, username, onClose, initialPrompt, selectedIds, onAIComplete }: ChatPanelProps) {
  const selectedIdsArray = useMemo(
    () => (selectedIds?.size ? [...selectedIds] : undefined),
    [selectedIds],
  );

  // Connect to ChatAgent DO instance named by boardId
  const agent = useAgent({ agent: "ChatAgent", name: boardId });

  const {
    messages: uiMessages,
    sendMessage: sdkSendMessage,
    status: sdkStatus,
    error: sdkError,
  } = useAgentChat({
    agent,
    body: { selectedIds: selectedIdsArray, username },
  });

  // Prefix [username] for multiplayer attribution in persisted history
  const sendMessage = useCallback(
    (text: string) => {
      const prefixed = username ? `[${username}] ${text}` : text;
      sdkSendMessage({ text: prefixed });
    },
    [sdkSendMessage, username],
  );

  const loading = sdkStatus === "streaming" || sdkStatus === "submitted";
  const error = sdkStatus === "error" ? (sdkError?.message || "Something went wrong") : undefined;
  const status =
    sdkStatus === "submitted"
      ? "Thinking..."
      : sdkStatus === "streaming"
        ? "Responding..."
        : "";

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

  return (
    <div style={{
      position: "absolute", top: 16, bottom: 72, right: 16, width: 360,
      zIndex: 30, background: "rgba(15, 23, 42, 0.97)", border: "1px solid #334155",
      borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", borderBottom: "1px solid #334155", flexShrink: 0,
        borderRadius: "12px 12px 0 0",
      }}>
        <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.875rem" }}>AI Assistant</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#94a3b8", cursor: "pointer",
          fontSize: "1.25rem", lineHeight: 1, padding: "0.25rem",
        }}>
          ✕
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto", padding: "1rem",
        display: "flex", flexDirection: "column", gap: "0.75rem",
      }}>
        {uiMessages.length === 0 && !loading && (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: "1rem" }}>
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

          if (msg.role === "user") {
            const match = displayText.match(SENDER_RE);
            if (match) {
              sender = match[1];
              displayText = displayText.slice(match[0].length);
            }
          }

          const content =
            displayText ||
            (tools.length > 0 ? "I performed the requested actions on the board." : "");

          const isMe = sender === username;
          const senderColor = msg.role === "assistant"
            ? colors.aiCursor
            : sender
              ? getUserColor(sender)
              : colors.accent;
          const senderLabel = msg.role === "assistant" ? "AI" : sender;

          return (
            <div key={msg.id} style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
            }}>
              {msg.role === "assistant" && tools.length > 0 && (
                <ToolHistory tools={tools} />
              )}
              {senderLabel && (
                <div style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color: senderColor,
                  marginBottom: 2,
                  textAlign: msg.role === "user" ? "right" : "left",
                  paddingLeft: msg.role === "user" ? 0 : 4,
                  paddingRight: msg.role === "user" ? 4 : 0,
                }}>
                  {isMe ? "You" : senderLabel}
                </div>
              )}
              <div style={{
                padding: "0.5rem 0.75rem",
                borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                background: msg.role === "user" ? colors.accent : "#1e293b",
                color: msg.role === "user" ? "#fff" : "#e2e8f0",
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {content}
              </div>
            </div>
          );
        })}
        {loading && (
          <div style={{
            alignSelf: "flex-start", padding: "0.5rem 0.75rem",
            borderRadius: "12px 12px 12px 4px", background: "#1e293b",
            color: "#94a3b8", fontSize: "0.8125rem",
            display: "flex", alignItems: "center", gap: 4, minHeight: 24,
          }}>
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
          <div style={{
            alignSelf: "flex-start", padding: "0.5rem 0.75rem",
            borderRadius: "12px 12px 12px 4px", background: "rgba(248, 113, 113, 0.1)",
            color: colors.error, fontSize: "0.8125rem",
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Chips bar: scene templates when empty, intent chips when in-scene */}
      <div style={{
        padding: "0.375rem 0.75rem", borderTop: "1px solid #1e293b", flexShrink: 0,
        display: "flex", gap: 6, overflowX: "auto", alignItems: "center",
      }}>
        {uiMessages.length === 0 ? (
          BOARD_TEMPLATES.map((t) => (
            <ChipButton
              key={t.label}
              label={t.label}
              color={colors.textMuted}
              borderRadius={6}
              disabled={loading}
              onClick={() => sendMessage(t.prompt)}
            />
          ))
        ) : (
          getIntentChips(userMessageCount).map((chip) => (
            <ChipButton
              key={chip.prompt}
              label={chip.prompt}
              color={CATEGORY_COLORS[chip.category]}
              borderRadius={16}
              disabled={loading}
              onClick={() => sendMessage(chip.prompt)}
            />
          ))
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: "0.75rem", borderTop: "1px solid #334155", flexShrink: 0,
        display: "flex", gap: "0.5rem", borderRadius: "0 0 12px 12px",
      }}>
        <textarea
          ref={inputRef}
          placeholder="Ask the AI..."
          onKeyDown={handleKeyDown}
          rows={1}
          style={{
            flex: 1, resize: "none", background: "#1e293b", border: "1px solid #334155",
            borderRadius: 8, padding: "0.5rem 0.75rem", color: "#e2e8f0",
            fontSize: "0.8125rem", outline: "none", fontFamily: "inherit",
            maxHeight: 120, overflowY: "auto",
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            background: loading ? colors.accentDark : colors.accent,
            border: "none", borderRadius: 8, color: "#fff",
            padding: "0.5rem 0.75rem", cursor: loading ? "not-allowed" : "pointer",
            fontSize: "0.8125rem", fontWeight: 600, flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
