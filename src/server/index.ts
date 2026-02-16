import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";

type Bindings = {
  DB: D1Database;
  BOARD: DurableObjectNamespace;
  AUTH_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());
app.use("/auth/*", cors());

app.get("/api/health", (c) => {
  return c.json({ status: "ok", version: "0.0.1" });
});

// Mount auth routes
app.route("/", auth);

export default app;

// Durable Object stub - will be implemented in board.ts
export class Board {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response("Board DO active", { status: 200 });
  }
}
