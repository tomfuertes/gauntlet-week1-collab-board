import React, { useRef, useEffect, useState } from "react";
import { useAIChat } from "../hooks/useAIChat";
import type { AIChatMessage } from "../hooks/useAIChat";
import { colors } from "../theme";
import { getToolIcon, toolSummary } from "../../shared/ai-tool-meta";

interface ChatPanelProps {
  boardId: string;
  onClose: () => void;
  initialPrompt?: string;
  selectedIds?: Set<string>;
  onAIComplete?: () => void;
}

const SUGGESTED_PROMPTS = [
  "What's on this board?",
  "Create a SWOT analysis",
  "Organize stickies by color",
  "Add 5 brainstorm ideas about AI",
];

const TEMPLATES: { label: string; prompt: string }[] = [
  {
    label: "SWOT",
    prompt: `Create a SWOT analysis with this exact layout:
createFrame "Strengths" x=50 y=80 width=440 height=280
createFrame "Weaknesses" x=520 y=80 width=440 height=280
createFrame "Opportunities" x=50 y=390 width=440 height=280
createFrame "Threats" x=520 y=390 width=440 height=280
Then add 2 stickies inside each frame:
Strengths: x=60,y=120 and x=260,y=120 (green #4ade80)
Weaknesses: x=530,y=120 and x=730,y=120 (red #f87171)
Opportunities: x=60,y=430 and x=260,y=430 (blue #60a5fa)
Threats: x=530,y=430 and x=730,y=430 (orange #fb923c)
Write brief example content on each sticky.`,
  },
  {
    label: "Kanban",
    prompt: `Create a Kanban board with this exact layout:
createFrame "To Do" x=50 y=80 width=320 height=680
createFrame "In Progress" x=400 y=80 width=320 height=680
createFrame "Done" x=750 y=80 width=320 height=680
Add 3 example task stickies in the To Do column:
x=60 y=120, x=60 y=340, x=60 y=550
Use yellow #fbbf24 stickies with brief task descriptions.`,
  },
  {
    label: "Retro",
    prompt: `Create a sprint retrospective with this exact layout:
createFrame "What Went Well" x=50 y=80 width=320 height=480
createFrame "What Didn't Go Well" x=400 y=80 width=320 height=480
createFrame "Action Items" x=750 y=80 width=320 height=480
Add 2 stickies per frame:
Went Well: x=60,y=120 and x=60,y=330 (green #4ade80)
Didn't Go Well: x=410,y=120 and x=410,y=330 (red #f87171)
Action Items: x=760,y=120 and x=760,y=330 (blue #60a5fa)
Write brief example content on each sticky.`,
  },
  {
    label: "Brainstorm",
    prompt: `Create a brainstorm layout:
createStickyNote "Main Topic" x=450 y=350 color=#c084fc
Then create 8 idea stickies in a circle around it:
x=450,y=100 x=700,y=180 x=780,y=350 x=700,y=520
x=450,y=600 x=200,y=520 x=120,y=350 x=200,y=180
Alternate colors: #fbbf24, #60a5fa, #4ade80, #f87171.
Write a creative brainstorm idea on each sticky.`,
  },
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

export function ChatPanel({ boardId, onClose, initialPrompt, selectedIds, onAIComplete }: ChatPanelProps) {
  const { messages, loading, status, sendMessage } = useAIChat(boardId, selectedIds);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialPromptHandled = useRef(false);

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

  // Focus input on mount; auto-send initialPrompt if provided
  useEffect(() => {
    if (initialPrompt && !initialPromptHandled.current) {
      initialPromptHandled.current = true;
      sendMessage(initialPrompt);
    } else {
      inputRef.current?.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <>
    <style>{`
      @keyframes chat-bounce {
        0%, 80%, 100% { transform: translateY(0); }
        40% { transform: translateY(-6px); }
      }
      .chat-bounce-dots { display: inline-flex; gap: 3px; align-items: center; height: 16px; }
      .chat-dot {
        width: 6px; height: 6px; border-radius: 50%; background: #94a3b8;
        animation: chat-bounce 1.4s ease-in-out infinite;
      }
      .chat-dot:nth-child(2) { animation-delay: 0.16s; }
      .chat-dot:nth-child(3) { animation-delay: 0.32s; }
      @keyframes chat-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .chat-pulse-text { animation: chat-pulse 2s ease-in-out infinite; }
    `}</style>
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
        {messages.map((msg) => (
          <div key={msg.id} style={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%",
          }}>
            {msg.role === "assistant" && msg.tools && (
              <ToolHistory tools={msg.tools} />
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
        ))}
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
        {TEMPLATES.map((t) => (
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
    </>
  );
}
