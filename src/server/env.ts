import type { Board } from "./board";
import type { ChatAgent } from "./chat-agent";

/** Server environment - single source of truth for all Hono routes */
export type Bindings = {
  DB: D1Database;
  BOARD: DurableObjectNamespace<Board>;
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>;
  AI: Ai;
  AUTH_SECRET: string;
  ANTHROPIC_API_KEY: string;
};

/** Result from Board DO mutations (mutate RPC) */
export type MutateResult = { ok: boolean; error?: string };
