import React, { useRef, useEffect, useState } from "react";
import { useAIChat, type AIChatMessage } from "../hooks/useAIChat";
import { colors, getUserColor } from "../theme";
import { getToolIcon, toolSummary } from "../../shared/ai-tool-meta";
import "../styles/animations.css";
import { BOARD_TEMPLATES } from "../../shared/board-templates";

interface ChatPanelProps {
  boardId: string;
  username?: string;
  onClose: () => void;
  initialPrompt?: string;
  selectedIds?: Set<string>;
  onAIComplete?: () => void;
}

const SUGGESTED_PROMPTS = [
  "Add a plot twist",
  "Introduce a new character",
  "What happens next?",
  "The health inspector arrives",
];

function ToolHistory({ tools }: { tools: NonNullable<AIChatMessage["tools"]> }) {
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

export function ChatPanel({ boardId, username, onClose, initialPrompt, selectedIds, onAIComplete }: ChatPanelProps) {
  const { messages, loading, status, sendMessage } = useAIChat(boardId, selectedIds, username);
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
  }, [messages, loading, status]);

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

  return (
    <div style={{
      position: "absolute", bottom: 72, right: 16, width: 360, maxHeight: "min(520px, calc(100vh - 140px))",
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
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: "1rem" }}>
              Try a suggestion to get started:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  style={{
                    background: "#1e293b", border: "1px solid #334155", borderRadius: 16,
                    padding: "6px 12px", cursor: "pointer", color: "#e2e8f0",
                    fontSize: "0.75rem", transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#334155"; }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender === username;
          const senderColor = msg.role === "assistant"
            ? colors.aiCursor
            : msg.sender
              ? getUserColor(msg.sender)
              : colors.accent;
          const senderLabel = msg.role === "assistant" ? "AI" : msg.sender;

          return (
            <div key={msg.id} style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
            }}>
              {msg.role === "assistant" && msg.tools && (
                <ToolHistory tools={msg.tools} />
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
                {msg.content}
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
      </div>

      {/* Templates */}
      <div style={{
        padding: "0.375rem 0.75rem", borderTop: "1px solid #1e293b", flexShrink: 0,
        display: "flex", gap: 6, overflowX: "auto",
      }}>
        {BOARD_TEMPLATES.map((t) => (
          <button
            key={t.label}
            onClick={() => sendMessage(t.prompt)}
            disabled={loading}
            style={{
              background: "none", border: "1px solid #334155", borderRadius: 6,
              padding: "3px 8px", cursor: loading ? "not-allowed" : "pointer",
              color: "#94a3b8", fontSize: "0.6875rem", whiteSpace: "nowrap",
              transition: "border-color 0.15s, color 0.15s", flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor = colors.accent; e.currentTarget.style.color = "#e2e8f0"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#94a3b8"; }}
          >
            {t.label}
          </button>
        ))}
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
