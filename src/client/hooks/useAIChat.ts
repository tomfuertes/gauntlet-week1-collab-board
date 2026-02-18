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
  tools?: ToolCall[];
}

export function useAIChat(boardId: string, selectedIds?: Set<string>) {
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
  } = useAgentChat({
    agent,
    body: { selectedIds: selectedIdsArray },
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

      return {
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content:
          content ||
          (tools.length > 0
            ? "I performed the requested actions on the board."
            : ""),
        tools: tools.length > 0 ? tools : undefined,
      };
    });
  }, [uiMessages]);

  const loading = sdkStatus === "streaming" || sdkStatus === "submitted";
  const status =
    sdkStatus === "submitted"
      ? "Thinking..."
      : sdkStatus === "streaming"
        ? "Responding..."
        : "";

  // Wrap sendMessage to match old interface (takes a string, not UIMessage)
  const sendMessage = useCallback(
    (text: string) => {
      sdkSendMessage({ text });
    },
    [sdkSendMessage],
  );

  return { messages, loading, status, sendMessage };
}
