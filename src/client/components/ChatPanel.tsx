import React, { useRef, useEffect } from "react";
import { useAIChat } from "../hooks/useAIChat";

interface ChatPanelProps {
  boardId: string;
  onClose: () => void;
}

export function ChatPanel({ boardId, onClose }: ChatPanelProps) {
  const { messages, loading, sendMessage } = useAIChat(boardId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      position: "absolute", top: 0, right: 0, bottom: 0, width: 380, zIndex: 30,
      background: "rgba(15, 23, 42, 0.97)", borderLeft: "1px solid #334155",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", borderBottom: "1px solid #334155", flexShrink: 0,
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
        {messages.length === 0 && (
          <div style={{ color: "#64748b", fontSize: "0.8125rem", textAlign: "center", marginTop: "2rem" }}>
            Ask me to create stickies, organize the board, or answer questions about what's on it.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%",
            padding: "0.5rem 0.75rem",
            borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
            background: msg.role === "user" ? "#3b82f6" : "#1e293b",
            color: msg.role === "user" ? "#fff" : "#e2e8f0",
            fontSize: "0.8125rem",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{
            alignSelf: "flex-start", padding: "0.5rem 0.75rem",
            borderRadius: "12px 12px 12px 4px", background: "#1e293b",
            color: "#94a3b8", fontSize: "0.8125rem",
          }}>
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: "0.75rem", borderTop: "1px solid #334155", flexShrink: 0,
        display: "flex", gap: "0.5rem",
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
            background: loading ? "#1e40af" : "#3b82f6",
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
