import { useState, useCallback, useRef, useEffect } from "react";

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
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  // Abort any in-flight SSE stream on unmount
  useEffect(() => {
    return () => { controllerRef.current?.abort(); };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: AIChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setStatus("Thinking...");

      try {
        console.debug("[ai-chat] sending:", text, "history:", messages.length);
        controllerRef.current?.abort(); // Cancel any previous in-flight request
        const controller = new AbortController();
        controllerRef.current = controller;
        const timeout = setTimeout(() => {
          console.warn("[ai-chat] request timed out after 60s");
          controller.abort();
        }, 60_000);

        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            boardId,
            history: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
            selectedIds: selectedIds?.size ? [...selectedIds] : undefined,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        console.debug("[ai-chat] response status:", res.status);

        // Parse SSE stream
        const tools: ToolCall[] = [];
        let responseText = "";

        if (res.headers.get("Content-Type")?.includes("text/event-stream") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Parse complete SSE events from buffer
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));
                console.debug("[ai-chat] event:", event);

                if (event.type === "status") {
                  setStatus(event.label);
                } else if (event.type === "tool") {
                  tools.push({ name: event.name, label: event.label, args: event.args });
                  setStatus(`${event.label}...`);
                } else if (event.type === "done") {
                  responseText = event.response;
                } else if (event.type === "error") {
                  responseText = event.message;
                }
              } catch {
                // partial JSON, ignore
              }
            }
          }
        } else {
          // Fallback: non-streaming JSON response
          const data = await res.json<{ response?: string; error?: string }>();
          responseText = data.response ?? data.error ?? "Something went wrong.";
        }

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: responseText || "I performed the requested actions on the board.",
            tools: tools.length > 0 ? tools : undefined,
          },
        ]);
      } catch (err) {
        const msg = err instanceof DOMException && err.name === "AbortError"
          ? "AI request timed out (60s). The model may be cold-starting - try again."
          : "Failed to reach AI. Try again.";
        console.error("[ai-chat] error:", err);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: msg },
        ]);
      } finally {
        controllerRef.current = null;
        setLoading(false);
        setStatus("");
      }
    },
    [boardId, messages, selectedIds],
  );

  return { messages, loading, status, sendMessage };
}
