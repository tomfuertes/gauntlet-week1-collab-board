import { DurableObject } from "cloudflare:workers";
import { AI_USER_ID, AI_USERNAME, SFX_EFFECTS } from "../shared/types";
import type {
  BoardObject,
  CanvasAction,
  MutateResult,
  Poll,
  PollOption,
  PollResult,
  ReplayEvent,
  SceneMood,
  WSClientMessage,
  WSServerMessage,
  WaveEffect,
} from "../shared/types";
import type { Bindings } from "./env";
import { recordBoardActivity, markBoardSeen } from "./env";
import { containsFlaggedContent } from "./chat-agent";

// KEY-DECISION 2026-02-20: Spectator attachment tracks reactionCount and lastHeckleAt
// so that heckle budget and rate-limit survive DO hibernation (unlike class properties).
// Cost: 5 reactions; rate limit: 1 heckle per 2 minutes per spectator.
type ConnectionMeta =
  | { role: "player"; userId: string; username: string; editingObjectId?: string }
  | { role: "spectator"; userId: string; username: string; reactionCount: number; lastHeckleAt: number };

// Allowed emoji set for spectator reactions (must match client REACTION_EMOJIS)
const ALLOWED_REACTION_EMOJIS = new Set([
  "\uD83D\uDC4F",
  "\uD83D\uDE02",
  "\uD83D\uDD25",
  "\u2764\uFE0F",
  "\uD83D\uDE2E",
  "\uD83C\uDFAD",
]);

export class Board extends DurableObject<Bindings> {
  // Timestamp when AI presence expires. Class properties reset on DO hibernation,
  // which is correct - if the DO hibernated, the AI stream has already ended.
  private aiActiveUntil = 0;
  // Cached boardId (lazy-loaded from DO Storage, set on first WS connect)
  private _boardId: string | null = null;
  // Rate limit: last reaction timestamp per userId (resets on hibernation, which is fine)
  private lastReactionAt = new Map<string, number>();
  // Rate limit: last SFX timestamp per userId - 1 SFX per user per 3s
  private lastSfxAt = new Map<string, number>();
  // Current scene mood (ephemeral - resets on hibernation, which is fine for atmospheric state)
  private currentMood: SceneMood = "neutral";

  // KEY-DECISION 2026-02-21: Audience wave detection uses class properties (not DO Storage)
  // because cooldowns are short-lived (30s/15s). Reset on hibernation is correct behavior.
  // Window: 3+ distinct spectators send the same emoji within 5s triggers a wave.
  private reactionWindow = new Map<string, { spectatorIds: Set<string>; firstAt: number }>();
  private lastWaveAt = new Map<string, number>(); // per-emoji cooldown (30s)
  private lastGlobalWaveAt = 0; // global cooldown (15s)

  // KEY-DECISION 2026-02-21: Polls are ephemeral class properties (not DO Storage).
  // If DO hibernates mid-poll, votes are lost - acceptable given 15s poll lifetime.
  // 1 active poll at a time; 30s cooldown between polls.
  private activePoll: Poll | null = null;
  private pollVotes = new Map<string, string>(); // spectatorId -> optionId
  private lastPollEndAt = 0;

  private async getBoardId(): Promise<string | null> {
    if (!this._boardId) {
      this._boardId = (await this.ctx.storage.get<string>("meta:boardId")) ?? null;
    }
    return this._boardId;
  }

  private async setBoardId(id: string): Promise<void> {
    this._boardId = id;
    await this.ctx.storage.put("meta:boardId", id);
  }

  // Event recording for scene replay
  private lastRecordedAt = new Map<string, number>(); // objId -> timestamp (debounce tracker)
  private eventCount = -1; // -1 = not yet loaded

  // --- RPC methods (called by Worker via stub) ---
  // readObjects, readObject, mutate, injectCursor implement the BoardStub contract (shared/types.ts)

  async getStats(): Promise<{ objectCount: number; eventCount: number }> {
    const [objs, evts] = await Promise.all([
      this.ctx.storage.list({ prefix: "obj:", limit: 501 }),
      this.ctx.storage.list({ prefix: "evt:", limit: 2001 }),
    ]);
    return { objectCount: objs.size, eventCount: evts.size };
  }

  async readObjects(): Promise<BoardObject[]> {
    return this.getAllObjects();
  }

  async readEvents(): Promise<ReplayEvent[]> {
    const entries = await this.ctx.storage.list<ReplayEvent>({ prefix: "evt:" });
    return [...entries.values()];
  }

  async readObject(id: string): Promise<BoardObject | null> {
    return (await this.ctx.storage.get<BoardObject>(`obj:${id}`)) ?? null;
  }

  async clearBoard(): Promise<number> {
    const keys = await this.ctx.storage.list({ prefix: "obj:" });
    await this.ctx.storage.delete([...keys.keys()]);
    this.broadcast({ type: "init", objects: [] });
    return keys.size;
  }

  async deleteBoard(): Promise<number> {
    const keys = await this.ctx.storage.list({ prefix: "obj:" });
    await this.ctx.storage.delete([...keys.keys()]);
    await this.ctx.storage.delete("meta:boardId");
    this.broadcast({ type: "board:deleted" });
    for (const ws of this.getWebSockets()) {
      try {
        ws.close(1000, "board deleted");
      } catch {
        /* already closed */
      }
    }
    return keys.size;
  }

  async mutate(msg: WSClientMessage): Promise<MutateResult> {
    return this.handleMutation(msg, AI_USER_ID);
  }

  /** Broadcast AI cursor position to all WS clients (virtual user - no real WS connection) */
  async injectCursor(x: number, y: number): Promise<void> {
    this.broadcast({
      type: "cursor",
      userId: AI_USER_ID,
      username: AI_USERNAME,
      x,
      y,
    });
  }

  /** Mark this board as publicly archived in D1 (called from ChatAgent on curtain phase).
   *  KEY-DECISION 2026-02-20: Board DO owns the D1 write so boardId is always available
   *  via getBoardId() - ChatAgent would need a separate D1 query to get it. */
  async archiveScene(): Promise<void> {
    const boardId = await this.getBoardId();
    if (!boardId) {
      console.debug(JSON.stringify({ event: "archive:skip", reason: "no-boardId" }));
      return;
    }
    try {
      await this.env.DB.prepare("UPDATE boards SET is_public = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(boardId)
        .run();
      console.debug(JSON.stringify({ event: "archive:scene", boardId }));
    } catch (err) {
      console.error(JSON.stringify({ event: "archive:error", boardId, error: String(err) }));
    }
  }

  /** Persist AI critic review + score to D1 (called from ChatAgent on curtain phase).
   *  KEY-DECISION 2026-02-20: Board DO owns the D1 write so boardId is always available
   *  via getBoardId() - same pattern as archiveScene(). */
  async saveCriticReview(review: string, score: number, model: string): Promise<void> {
    const boardId = await this.getBoardId();
    if (!boardId) {
      console.debug(JSON.stringify({ event: "critic:skip", reason: "no-boardId" }));
      return;
    }
    try {
      await this.env.DB.prepare(
        "UPDATE boards SET critic_review = ?, critic_score = ?, critic_model = ?, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(review, score, model, boardId)
        .run();
      console.debug(JSON.stringify({ event: "critic:saved", boardId, score, model }));
    } catch (err) {
      console.error(JSON.stringify({ event: "critic:error", boardId, error: String(err) }));
    }
  }

  /** Broadcast theatrical curtain call to all WS clients (called from ChatAgent at scene end).
   *  Fetches board name from D1 to populate sceneTitle for the client applause overlay.
   *  KEY-DECISION 2026-02-20: Board DO owns the D1 read (same pattern as archiveScene/saveCriticReview). */
  async broadcastCurtainCall(characters: { id: string; name: string }[]): Promise<void> {
    const boardId = await this.getBoardId();
    let sceneTitle = "Untitled Scene";
    if (boardId) {
      try {
        const row = await this.env.DB.prepare("SELECT name FROM boards WHERE id = ?")
          .bind(boardId)
          .first<{ name: string }>();
        if (row?.name) sceneTitle = row.name;
      } catch {
        // Non-fatal: broadcast with default title
      }
    }
    this.broadcast({ type: "curtain_call", characters, sceneTitle });
    console.debug(
      JSON.stringify({ event: "curtain-call:broadcast", boardId, sceneTitle, characterCount: characters.length }),
    );
  }

  /** Create an audience poll (called via RPC from ChatAgent's askAudience tool).
   *  Rate-limited: 1 active poll at a time, 30s cooldown between polls. */
  async createPoll(question: string, options: PollOption[]): Promise<{ ok: boolean; error?: string }> {
    if (this.activePoll) {
      return { ok: false, error: "A poll is already active" };
    }
    if (Date.now() - this.lastPollEndAt < 30_000) {
      return { ok: false, error: "Poll cooldown in effect (30s between polls)" };
    }
    if (!question || options.length < 2 || options.length > 4) {
      return { ok: false, error: "Poll requires a question and 2-4 options" };
    }
    const poll: Poll = {
      id: crypto.randomUUID(),
      question,
      options,
      expiresAt: Date.now() + 15_000,
    };
    this.activePoll = poll;
    this.pollVotes = new Map();
    await this.ctx.storage.setAlarm(poll.expiresAt);
    this.broadcast({ type: "poll:start", poll });
    console.debug(JSON.stringify({ event: "poll:start", pollId: poll.id, question }));
    return { ok: true };
  }

  /** DO alarm handler - fires when poll expires, tallies votes, notifies ChatAgent. */
  async alarm(): Promise<void> {
    const poll = this.activePoll;
    if (!poll) return; // stale alarm (e.g. after hibernation reset)

    const votes = this.pollVotes;
    const tally: Record<string, number> = {};
    for (const opt of poll.options) tally[opt.id] = 0;
    for (const optionId of votes.values()) {
      if (optionId in tally) tally[optionId]++;
    }

    const totalVotes = votes.size;
    // Pick winner: highest vote count, tie-breaks to first option
    const winnerId = poll.options.reduce(
      (best, opt) => ((tally[opt.id] ?? 0) > (tally[best] ?? 0) ? opt.id : best),
      poll.options[0].id,
    );
    const winner = poll.options.find((o) => o.id === winnerId) ?? poll.options[0];

    const result: PollResult = {
      pollId: poll.id,
      question: poll.question,
      options: poll.options,
      winner,
      votes: tally,
      totalVotes,
    };

    // Reset state before notifying to prevent races
    this.activePoll = null;
    this.pollVotes = new Map();
    this.lastPollEndAt = Date.now();

    this.broadcast({ type: "poll:result", result });
    console.debug(JSON.stringify({ event: "poll:result", pollId: result.pollId, winner: winner.label, totalVotes }));

    // Notify ChatAgent so result injects into next AI response
    this.notifyPollResult(result);
  }

  /** Set AI presence visibility in the presence list */
  async setAiPresence(active: boolean): Promise<void> {
    this.aiActiveUntil = active ? Date.now() + 60_000 : 0;
    const { users, spectatorCount } = this.getPresenceList();
    this.broadcast({ type: "presence", users, spectatorCount });
  }

  /** Delete all objects created by a specific AI batch, broadcast deletions */
  private async undoBatch(batchId: string): Promise<void> {
    const entries = await this.ctx.storage.list<BoardObject>({ prefix: "obj:" });
    const toDelete: string[] = [];
    for (const [key, obj] of entries) {
      if (obj.batchId === batchId) toDelete.push(key);
    }
    if (toDelete.length === 0) return;
    await this.ctx.storage.delete(toDelete);
    for (const key of toDelete) {
      const id = key.slice(4); // strip "obj:" prefix
      this.broadcast({ type: "obj:delete", id });
    }
  }

  // --- WebSocket upgrade (requires HTTP) ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const username = url.searchParams.get("username");
    const boardId = url.searchParams.get("boardId");
    const role = url.searchParams.get("role") === "spectator" ? ("spectator" as const) : ("player" as const);
    if (!userId || !username) {
      return new Response("Missing user info", { status: 400 });
    }

    // Persist boardId for activity tracking (skips write if already stored)
    if (boardId && !(await this.getBoardId())) await this.setBoardId(boardId);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    const initialMeta: ConnectionMeta =
      role === "spectator"
        ? { role: "spectator", userId, username, reactionCount: 0, lastHeckleAt: 0 }
        : { role: "player", userId, username };
    server.serializeAttachment(initialMeta);

    const objects = await this.getAllObjects();
    const { users, spectatorCount } = this.getPresenceList();
    server.send(JSON.stringify({ type: "init", objects } satisfies WSServerMessage));
    server.send(JSON.stringify({ type: "presence", users, spectatorCount } satisfies WSServerMessage));
    // Sync current mood to new connections so late-joiners see the active atmosphere
    if (this.currentMood !== "neutral") {
      server.send(JSON.stringify({ type: "mood", mood: this.currentMood, intensity: 0.3 } satisfies WSServerMessage));
    }
    this.broadcast({ type: "presence", users, spectatorCount }, server);

    // Mark board as seen for connecting user (non-blocking)
    if (boardId) {
      this.ctx.waitUntil(
        markBoardSeen(this.env.DB, userId, boardId).catch((err: unknown) => {
          console.error(JSON.stringify({ event: "activity:markSeen", trigger: "ws:connect", error: String(err) }));
        }),
      );
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- WebSocket Hibernation API handlers ---

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const meta = ws.deserializeAttachment() as ConnectionMeta | null;
    if (!meta) return;

    let msg: WSClientMessage;
    try {
      msg = JSON.parse(raw as string) as WSClientMessage;
    } catch {
      // intentional: malformed client messages are non-recoverable
      console.warn("[WS] malformed message, ignoring");
      return;
    }

    // Spectators can only send cursor updates, reactions, heckles, and poll votes
    if (
      meta.role === "spectator" &&
      msg.type !== "cursor" &&
      msg.type !== "reaction" &&
      msg.type !== "heckle" &&
      msg.type !== "poll:vote"
    ) {
      console.warn(JSON.stringify({ event: "spectator:blocked", type: msg.type, userId: meta.userId }));
      return;
    }

    if (msg.type === "cursor") {
      this.broadcast({ type: "cursor", userId: meta.userId, username: meta.username, x: msg.x, y: msg.y }, ws);
      return;
    }

    if (msg.type === "reaction") {
      if (!ALLOWED_REACTION_EMOJIS.has(msg.emoji)) return;
      // Rate limit: 1 reaction per second per user
      const now = Date.now();
      const last = this.lastReactionAt.get(meta.userId) ?? 0;
      if (now - last < 1000) return;
      this.lastReactionAt.set(meta.userId, now);
      this.broadcast({ type: "reaction", userId: meta.userId, emoji: msg.emoji, x: msg.x, y: msg.y });
      // Only spectator reactions count toward the challenge leaderboard and heckle budget
      if (meta.role === "spectator") {
        this.trackReaction();
        // Increment per-connection reaction count (persisted in attachment for heckle budget)
        const updated: ConnectionMeta = { ...meta, reactionCount: meta.reactionCount + 1 };
        ws.serializeAttachment(updated);
        // Feed into wave detection (spectators only - audience wave mechanics)
        this.checkWave(msg.emoji, meta.userId, now);
      }
      return;
    }

    if (msg.type === "heckle" && meta.role === "spectator") {
      const now = Date.now();
      const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 100) : "";
      // Validate: must have content, enough reactions, and not be on cooldown
      if (!text) return;
      if (meta.reactionCount < 5) {
        console.warn(
          JSON.stringify({
            event: "heckle:rejected",
            reason: "insufficient-reactions",
            userId: meta.userId,
            reactionCount: meta.reactionCount,
          }),
        );
        return;
      }
      if (now - meta.lastHeckleAt < 120_000) {
        console.warn(JSON.stringify({ event: "heckle:rejected", reason: "rate-limit", userId: meta.userId }));
        return;
      }
      if (containsFlaggedContent(text)) {
        console.warn(JSON.stringify({ event: "heckle:rejected", reason: "content-flagged", userId: meta.userId }));
        return;
      }
      // Deduct 5 reactions and update cooldown in attachment
      const updated: ConnectionMeta = { ...meta, reactionCount: meta.reactionCount - 5, lastHeckleAt: now };
      ws.serializeAttachment(updated);
      // Broadcast to ALL clients (players + spectators)
      this.broadcast({ type: "heckle", userId: meta.userId, text });
      // Forward to ChatAgent so AI can react in next response
      this.notifyHeckle(meta.userId, text);
      return;
    }

    if (msg.type === "poll:vote" && meta.role === "spectator") {
      const poll = this.activePoll;
      if (!poll) return; // no active poll
      if (poll.id !== msg.pollId) return; // stale vote for expired poll
      if (this.pollVotes.has(meta.userId)) return; // already voted
      const validOption = poll.options.find((o) => o.id === msg.optionId);
      if (!validOption) return; // invalid option
      this.pollVotes.set(meta.userId, msg.optionId);
      console.debug(
        JSON.stringify({ event: "poll:vote", pollId: poll.id, userId: meta.userId, optionId: msg.optionId }),
      );
      return;
    }

    if (msg.type === "chat:bubble" && meta.role === "player") {
      const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 200) : "";
      if (!text) return;
      // Broadcast to ALL clients (players + spectators) so the stage chat is visible to audience
      this.broadcast({ type: "chat:bubble", userId: meta.userId, username: meta.username, text });
      return;
    }

    if (msg.type === "sfx" && meta.role === "player") {
      // Validate effect against whitelist
      const sfxDef = SFX_EFFECTS.find((e) => e.id === msg.effect);
      if (!sfxDef) return;
      // Rate limit: 1 SFX per user per 3s
      const sfxNow = Date.now();
      const lastSfx = this.lastSfxAt.get(meta.userId) ?? 0;
      if (sfxNow - lastSfx < 3000) return;
      this.lastSfxAt.set(meta.userId, sfxNow);
      // Broadcast to ALL clients including sender (no excludeWs) - visual effect for everyone
      this.broadcast({ type: "sfx", userId: meta.userId, effect: msg.effect, x: msg.x, y: msg.y });
      // Notify ChatAgent so AI can react to the sound cue
      this.notifySfxAction(msg.effect, sfxDef.label);
      return;
    }

    if (msg.type === "text:cursor" && meta.role === "player") {
      const updated: ConnectionMeta = {
        role: "player",
        userId: meta.userId,
        username: meta.username,
        editingObjectId: msg.objectId,
      };
      ws.serializeAttachment(updated);
      this.broadcast(
        {
          type: "text:cursor",
          userId: meta.userId,
          username: meta.username,
          objectId: msg.objectId,
          position: msg.position,
        },
        ws,
      );
      return;
    }

    if (msg.type === "text:blur" && meta.role === "player") {
      const updated: ConnectionMeta = { role: "player", userId: meta.userId, username: meta.username };
      ws.serializeAttachment(updated);
      this.broadcast({ type: "text:blur", userId: meta.userId, objectId: msg.objectId }, ws);
      return;
    }

    if (msg.type === "batch:undo") {
      await this.undoBatch(msg.batchId);
      return;
    }

    await this.handleMutation(msg, meta.userId, ws, meta.username);
  }

  async webSocketClose(ws: WebSocket) {
    // ws is already closed when this handler fires - no need to call ws.close()
    this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket) {
    ws.close();
    this.handleDisconnect(ws);
  }

  // --- Private helpers ---

  private handleDisconnect(ws: WebSocket): void {
    const meta = ws.deserializeAttachment() as ConnectionMeta | null;
    if (meta && meta.role === "player" && meta.editingObjectId) {
      this.broadcast({ type: "text:blur", userId: meta.userId, objectId: meta.editingObjectId });
    }
    const { users, spectatorCount } = this.getPresenceList();
    this.broadcast({ type: "presence", users, spectatorCount });

    // Mark board as seen on disconnect (catches activity created during the session)
    if (meta) {
      this.markSeenForUser(meta.userId);
    }
  }

  private getWebSockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  private broadcast(msg: WSServerMessage, exclude?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(data);
        } catch {
          // Dead connection, will be cleaned up on close/error
        }
      }
    }
  }

  private async getAllObjects(): Promise<BoardObject[]> {
    const entries = await this.ctx.storage.list<BoardObject>({ prefix: "obj:" });
    return [...entries.values()];
  }

  private getPresenceList(): { users: { id: string; username: string }[]; spectatorCount: number } {
    const seen = new Set<string>();
    const users: { id: string; username: string }[] = [];
    let spectatorCount = 0;
    for (const ws of this.getWebSockets()) {
      const meta = ws.deserializeAttachment() as ConnectionMeta | null;
      if (!meta) continue;
      if (meta.role === "spectator") {
        spectatorCount++;
        continue;
      }
      if (!seen.has(meta.userId)) {
        seen.add(meta.userId);
        users.push({ id: meta.userId, username: meta.username });
      }
    }
    if (this.aiActiveUntil > Date.now()) {
      users.push({ id: AI_USER_ID, username: AI_USERNAME });
    }
    return { users, spectatorCount };
  }

  private async recordEvent(event: ReplayEvent, debounceMs = 500): Promise<void> {
    const MAX_EVENTS = 2000;

    // Debounce obj:update - skip if within debounce window since last recorded
    if (event.type === "obj:update" && event.obj) {
      const last = this.lastRecordedAt.get(event.obj.id);
      if (last && event.ts - last < debounceMs) return;
      this.lastRecordedAt.set(event.obj.id, event.ts);
    }

    // Lazy-load event count on first call (resets on hibernation, re-counted on next mutation)
    if (this.eventCount < 0) {
      const all = await this.ctx.storage.list({ prefix: "evt:", limit: MAX_EVENTS + 1 });
      this.eventCount = all.size;
    }

    if (this.eventCount >= MAX_EVENTS) return;

    // Key: evt:{16-digit-padded-ts}:{4-char-random} for lexicographic chronological order
    const ts = String(event.ts).padStart(16, "0");
    const rand = crypto.randomUUID().slice(0, 4);
    await this.ctx.storage.put(`evt:${ts}:${rand}`, event);
    this.eventCount++;
  }

  private async handleMutation(
    msg: WSClientMessage,
    userId: string,
    excludeWs?: WebSocket,
    username?: string,
  ): Promise<MutateResult> {
    switch (msg.type) {
      case "obj:create": {
        if (msg.obj.type === "image" && !msg.obj.props?.src) {
          return { ok: false, error: "Image objects require props.src" };
        }
        const obj = { ...msg.obj, createdBy: userId, updatedAt: Date.now() };
        await this.ctx.storage.put(`obj:${obj.id}`, obj);
        this.broadcast({ type: "obj:create", obj }, excludeWs);
        await this.recordEvent({ type: "obj:create", ts: obj.updatedAt, obj });
        this.trackActivity();
        if (userId !== AI_USER_ID && username) {
          this.notifyCanvasAction({
            type: "obj:create",
            userId,
            username,
            objectType: obj.type,
            objectId: obj.id,
            text: (obj.props as { text?: string }).text,
            significant: true,
            ts: obj.updatedAt,
          });
        }
        return { ok: true };
      }
      case "obj:update": {
        // No trackActivity() here - obj:update fires per drag pixel, would flood D1.
        // Create/delete + chat messages capture meaningful activity for badges.
        const existing = await this.ctx.storage.get<BoardObject>(`obj:${msg.obj.id}`);
        if (!existing) return { ok: false, error: `Object ${msg.obj.id} not found` };
        if (msg.obj.updatedAt && msg.obj.updatedAt < existing.updatedAt)
          return { ok: false, error: "Stale update (LWW conflict)" };
        const updated = {
          ...existing,
          ...msg.obj,
          props: { ...existing.props, ...(msg.obj.props || {}) },
          updatedAt: Date.now(),
        } as BoardObject;
        await this.ctx.storage.put(`obj:${updated.id}`, updated);
        const animField = "anim" in msg && msg.anim ? { anim: msg.anim } : {};
        this.broadcast({ type: "obj:update", obj: updated, ...animField }, excludeWs);
        const isSpatial =
          (msg.obj.x !== undefined && msg.obj.x !== existing.x) ||
          (msg.obj.y !== undefined && msg.obj.y !== existing.y) ||
          (msg.obj.width !== undefined && msg.obj.width !== existing.width) ||
          (msg.obj.height !== undefined && msg.obj.height !== existing.height) ||
          (msg.obj.rotation !== undefined && msg.obj.rotation !== existing.rotation);
        await this.recordEvent(
          { type: "obj:update", ts: updated.updatedAt, obj: updated, ...animField },
          isSpatial ? 100 : 500,
        );
        if (userId !== AI_USER_ID && username) {
          const existingText = (existing.props as { text?: string }).text;
          const newText = msg.obj.props?.text;
          const textChanged = newText !== undefined && newText !== existingText;
          this.notifyCanvasAction({
            type: "obj:update",
            userId,
            username,
            objectType: updated.type,
            objectId: updated.id,
            text: (updated.props as { text?: string }).text,
            significant: textChanged,
            ts: updated.updatedAt,
          });
        }
        return { ok: true };
      }
      case "obj:delete": {
        await this.ctx.storage.delete(`obj:${msg.id}`);
        this.broadcast({ type: "obj:delete", id: msg.id }, excludeWs);
        await this.recordEvent({ type: "obj:delete", ts: Date.now(), id: msg.id });
        this.trackActivity();
        // Cascade: disconnect lines that referenced the deleted object (soft - keeps line, clears binding)
        this.ctx.waitUntil(this.disconnectLines(msg.id));
        if (userId !== AI_USER_ID && username) {
          this.notifyCanvasAction({
            type: "obj:delete",
            userId,
            username,
            objectId: msg.id,
            significant: true,
            ts: Date.now(),
          });
        }
        return { ok: true };
      }
      case "obj:effect": {
        // Broadcast-only transient effect - no storage write, no replay event
        this.broadcast({ type: "obj:effect", id: msg.id, effect: msg.effect });
        return { ok: true };
      }
      case "obj:sequence": {
        // KEY-DECISION 2026-02-20: Apply final positions to DO Storage immediately so state is
        // consistent after the sequence plays. Clients handle the timed playback via setTimeout.
        // Broadcast to ALL clients (no excludeWs) since there's no optimistic apply for sequences.
        for (const step of msg.steps) {
          if (step.action === "move" && step.x !== undefined && step.y !== undefined) {
            const existing = await this.ctx.storage.get<BoardObject>(`obj:${step.objectId}`);
            if (existing) {
              const updated = { ...existing, x: step.x, y: step.y, updatedAt: Date.now() };
              await this.ctx.storage.put(`obj:${step.objectId}`, updated);
            }
          }
        }
        this.broadcast({ type: "obj:sequence", steps: msg.steps });
        return { ok: true };
      }
      case "obj:transient": {
        // KEY-DECISION 2026-02-20: obj:transient is a pure canvas visual effect (sparkle, poof,
        // explosion, highlight) at a canvas position. No storage, no replay - clients auto-remove
        // after effect.duration ms. Same broadcast-all pattern as sfx/spotlight/blackout.
        this.broadcast({ type: "obj:transient", effect: msg.effect });
        return { ok: true };
      }
      case "spotlight": {
        // KEY-DECISION 2026-02-20: Broadcast to ALL clients including sender (no excludeWs).
        // Spotlight is a pure ephemeral visual effect - no storage, no replay, all clients sync.
        this.broadcast({ type: "spotlight", objectId: msg.objectId, x: msg.x, y: msg.y });
        return { ok: true };
      }
      case "blackout": {
        // Same pattern as spotlight: ephemeral, broadcast-all, no persistence.
        this.broadcast({ type: "blackout" });
        return { ok: true };
      }
      case "sfx": {
        // KEY-DECISION 2026-02-20: Broadcast to ALL clients (no excludeWs).
        // SFX is an ephemeral theatrical effect - all clients should see the burst.
        // When called via mutate() RPC (AI tool), userId is AI_USER_ID.
        this.broadcast({ type: "sfx", userId: userId, effect: msg.effect, x: msg.x, y: msg.y });
        return { ok: true };
      }
      case "mood": {
        // Ephemeral atmospheric state - store in class property (resets on hibernation, correct behavior).
        // Broadcast to ALL clients so every viewer sees the ambient lighting shift.
        this.currentMood = msg.mood;
        this.broadcast({ type: "mood", mood: msg.mood, intensity: msg.intensity });
        console.debug(JSON.stringify({ event: "ai:mood", mood: msg.mood, intensity: msg.intensity }));
        return { ok: true };
      }
    }
    return { ok: false, error: `Unknown message type` };
  }

  /** Soft-disconnect lines referencing a deleted object (clears binding, keeps line as static) */
  private async disconnectLines(deletedId: string): Promise<void> {
    const entries = await this.ctx.storage.list<BoardObject>({ prefix: "obj:" });
    for (const [key, obj] of entries) {
      if (obj.type !== "line") continue;
      if (obj.startObjectId !== deletedId && obj.endObjectId !== deletedId) continue;
      const updated = {
        ...obj,
        startObjectId: obj.startObjectId === deletedId ? undefined : obj.startObjectId,
        endObjectId: obj.endObjectId === deletedId ? undefined : obj.endObjectId,
        updatedAt: Date.now(),
      };
      await this.ctx.storage.put(key, updated);
      this.broadcast({ type: "obj:update", obj: updated });
    }
  }

  /** Fire-and-forget canvas action notification to ChatAgent (non-blocking).
   *  KEY-DECISION 2026-02-20: Board DO notifies ChatAgent so the director has real-time
   *  visibility into player canvas activity without polling. Uses withBoardId() for the same
   *  fire-and-forget + error-logging pattern as trackActivity(). */
  private notifyCanvasAction(action: CanvasAction): void {
    this.withBoardId("canvas-action:notify", async (boardId) => {
      const id = this.env.CHAT_AGENT.idFromName(boardId);
      const chatAgent = this.env.CHAT_AGENT.get(id);
      await chatAgent.onCanvasAction(action);
    });
  }

  /** Fire-and-forget SFX notification to ChatAgent - AI can react to the sound cue. */
  private notifySfxAction(effectId: string, label: string): void {
    this.withBoardId("sfx:notify", async (boardId) => {
      const id = this.env.CHAT_AGENT.idFromName(boardId);
      const chatAgent = this.env.CHAT_AGENT.get(id);
      await chatAgent.onSfxAction(effectId, label);
    });
  }

  /** Fire-and-forget poll result notification to ChatAgent - AI injects result in next response. */
  private notifyPollResult(result: PollResult): void {
    this.withBoardId("poll-result:notify", async (boardId) => {
      const id = this.env.CHAT_AGENT.idFromName(boardId);
      const chatAgent = this.env.CHAT_AGENT.get(id);
      await chatAgent.onPollResult(result);
    });
  }

  /** Fire-and-forget heckle notification to ChatAgent - AI incorporates on next response. */
  private notifyHeckle(userId: string, text: string): void {
    this.withBoardId("heckle:notify", async (boardId) => {
      const id = this.env.CHAT_AGENT.idFromName(boardId);
      const chatAgent = this.env.CHAT_AGENT.get(id);
      await chatAgent.onHeckle(userId, text);
    });
  }

  // Emoji -> canvas wave effect mapping (must match ALLOWED_REACTION_EMOJIS order)
  private static readonly EMOJI_EFFECTS: ReadonlyMap<string, WaveEffect> = new Map([
    ["\uD83D\uDC4F", "confetti"], // 👏 applause
    ["\uD83D\uDE02", "shake"], // 😂 laugh
    ["\uD83D\uDD25", "glow"], // 🔥 fire
    ["\u2764\uFE0F", "hearts"], // ❤️ heart
    ["\uD83D\uDE2E", "spotlight"], // 😮 surprise
    ["\uD83C\uDFAD", "dramatic"], // 🎭 theater masks
  ]);

  /** Sliding-window wave detector: 3+ distinct spectators same emoji within 5s. */
  private checkWave(emoji: string, spectatorId: string, now: number): void {
    const WINDOW_MS = 5_000;
    const WAVE_THRESHOLD = 3;
    const PER_EMOJI_COOLDOWN_MS = 30_000;
    const GLOBAL_COOLDOWN_MS = 15_000;

    // Prune expired entries for this emoji
    const entry = this.reactionWindow.get(emoji) ?? { spectatorIds: new Set<string>(), firstAt: now };
    if (now - entry.firstAt > WINDOW_MS) {
      entry.spectatorIds = new Set();
      entry.firstAt = now;
    }
    entry.spectatorIds.add(spectatorId);
    this.reactionWindow.set(emoji, entry);

    if (entry.spectatorIds.size < WAVE_THRESHOLD) return;

    // Check cooldowns
    const lastWave = this.lastWaveAt.get(emoji) ?? 0;
    if (now - lastWave < PER_EMOJI_COOLDOWN_MS) return;
    if (now - this.lastGlobalWaveAt < GLOBAL_COOLDOWN_MS) return;

    const effect = Board.EMOJI_EFFECTS.get(emoji);
    if (!effect) return;

    const count = entry.spectatorIds.size;

    // Reset window + update cooldowns
    this.reactionWindow.delete(emoji);
    this.lastWaveAt.set(emoji, now);
    this.lastGlobalWaveAt = now;

    // Broadcast to ALL clients (players + spectators)
    this.broadcast({ type: "audience:wave", emoji, count, effect });
    console.debug(JSON.stringify({ event: "audience:wave", emoji, count, effect }));

    // Notify ChatAgent for atmospheric injection on next AI response
    this.notifyWave(emoji, count);
  }

  /** Fire-and-forget wave notification to ChatAgent - AI gets atmospheric context on next response. */
  private notifyWave(emoji: string, count: number): void {
    this.withBoardId("wave:notify", async (boardId) => {
      const id = this.env.CHAT_AGENT.idFromName(boardId);
      const chatAgent = this.env.CHAT_AGENT.get(id);
      await chatAgent.onAudienceWave(emoji, count);
    });
  }

  /** Fire-and-forget D1 activity increment (non-blocking) */
  private trackActivity(): void {
    this.withBoardId("activity:record", (id) => recordBoardActivity(this.env.DB, id));
  }

  /** Fire-and-forget challenge reaction count increment (no-op if board not linked to a challenge) */
  private trackReaction(): void {
    this.withBoardId("challenge:reaction", (boardId) =>
      this.env.DB.prepare("UPDATE challenge_entries SET reaction_count = reaction_count + 1 WHERE board_id = ?")
        .bind(boardId)
        .run(),
    );
  }

  /** Fire-and-forget mark-seen for a user (non-blocking) */
  private markSeenForUser(userId: string): void {
    this.withBoardId("activity:markSeen", (id) => markBoardSeen(this.env.DB, userId, id));
  }

  /** Run a D1 operation with the cached boardId (fire-and-forget, errors logged) */
  private withBoardId(event: string, fn: (boardId: string) => Promise<unknown>): void {
    this.ctx.waitUntil(
      this.getBoardId()
        .then((boardId) => {
          if (boardId) {
            return fn(boardId).catch((err: unknown) => {
              console.error(JSON.stringify({ event, error: String(err) }));
            });
          }
        })
        .catch((err: unknown) => {
          console.error(JSON.stringify({ event: "activity:getBoardId:error", error: String(err) }));
        }),
    );
  }
}
