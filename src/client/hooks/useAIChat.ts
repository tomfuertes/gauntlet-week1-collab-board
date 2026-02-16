import { useState, useCallback } from "react";
import type { ChatMessage } from "@shared/types";

export function useAIChat(boardId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            boardId,
            history: messages,
          }),
        });

        const data = await res.json<{ response?: string; error?: string }>();

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response ?? data.error ?? "Something went wrong.",
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: "Failed to reach AI. Try again." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [boardId, messages],
  );

  return { messages, loading, sendMessage };
}
