import { useCallback, useMemo } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";

interface ToolCall {
  name: string;
  label: string;
  args?: Record<string, unknown>;
}

export interface AIChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sender?: string;
  tools?: ToolCall[];
}

const SENDER_RE = /^\[([^\]]+)\]\s*/;

export function useAIChat(boardId: string, selectedIds?: Set<string>, username?: string) {
  // Connect to ChatAgent DO instance named by boardId
  const agent = useAgent({
    agent: "ChatAgent",
    name: boardId,
  });

  const selectedIdsArray = useMemo(
    () => (selectedIds?.size ? [...selectedIds] : undefined),
    [selectedIds],
  );

  const {
    messages: uiMessages,
    sendMessage: sdkSendMessage,
    status: sdkStatus,
    error: sdkError,
  } = useAgentChat({
    agent,
    body: { selectedIds: selectedIdsArray, username },
  });

  // Map UIMessage[] to AIChatMessage[] for ChatPanel compatibility
  const messages: AIChatMessage[] = useMemo(() => {
    return uiMessages.map((msg: UIMessage) => {
      let content = "";
      const tools: ToolCall[] = [];

      for (const part of msg.parts) {
        if (part.type === "text") {
          content += part.text;
        } else if (isToolUIPart(part)) {
          const toolName = getToolName(part);
          tools.push({
            name: toolName,
            label: toolName, // ChatPanel uses ai-tool-meta.ts for display
            args: part.input as Record<string, unknown>,
          });
        }
      }

      // Extract [username] prefix from user messages for multiplayer attribution
      let sender: string | undefined;
      let displayContent = content;
      if (msg.role === "user") {
        const match = content.match(SENDER_RE);
        if (match) {
          sender = match[1];
          displayContent = content.slice(match[0].length);
        }
      }

      return {
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content:
          displayContent ||
          (tools.length > 0
            ? "I performed the requested actions on the board."
            : ""),
        sender,
        tools: tools.length > 0 ? tools : undefined,
      };
    });
  }, [uiMessages]);

  const loading = sdkStatus === "streaming" || sdkStatus === "submitted";
  const error = sdkStatus === "error" ? (sdkError?.message || "Something went wrong") : undefined;
  const status =
    sdkStatus === "submitted"
      ? "Thinking..."
      : sdkStatus === "streaming"
        ? "Responding..."
        : "";

  // Wrap sendMessage to match old interface (takes a string, not UIMessage)
  // Prefix [username] for multiplayer attribution in persisted history
  const sendMessage = useCallback(
    (text: string) => {
      const prefixed = username ? `[${username}] ${text}` : text;
      sdkSendMessage({ text: prefixed });
    },
    [sdkSendMessage, username],
  );

  return { messages, loading, status, error, sendMessage };
}
