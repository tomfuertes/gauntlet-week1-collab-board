// Flat union (backward compat for partial updates)
export interface BoardObjectProps {
  text?: string;
  color?: string;
  fill?: string;
  stroke?: string;
  arrow?: "none" | "end" | "both";
  src?: string;
  prompt?: string;
}

// Per-type narrowed props
type StickyProps = Pick<BoardObjectProps, "text" | "color">;
type RectProps = Pick<BoardObjectProps, "fill" | "stroke">;
type CircleProps = Pick<BoardObjectProps, "fill" | "stroke">;
type LineProps = Pick<BoardObjectProps, "stroke" | "arrow">;
type TextObjectProps = Pick<BoardObjectProps, "text" | "color">;
type FrameProps = Pick<BoardObjectProps, "text">;
type ImageObjectProps = Pick<BoardObjectProps, "src" | "prompt">;
type PersonProps = Pick<BoardObjectProps, "text" | "color">; // text = character name, color = figure color

type BoardObjectVariant =
  | { type: "sticky"; props: StickyProps }
  | { type: "rect"; props: RectProps }
  | { type: "circle"; props: CircleProps }
  | { type: "line"; props: LineProps }
  | { type: "text"; props: TextObjectProps }
  | { type: "frame"; props: FrameProps }
  | { type: "image"; props: ImageObjectProps }
  | { type: "person"; props: PersonProps };

interface BoardObjectBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  createdBy: string;
  updatedAt: number;
  batchId?: string;
  startObjectId?: string; // line only: source object for connected lines
  endObjectId?: string; // line only: target object for connected lines
  isBackground?: boolean;
}

export type BoardObject = BoardObjectBase & BoardObjectVariant;

// For partial updates - flat props, no discriminant enforcement
export type BoardObjectUpdate = Partial<Omit<BoardObjectBase, "id">> & {
  id: string;
  type?: BoardObject["type"];
  props?: BoardObjectProps;
};

export type EffectType = "pulse" | "shake" | "flash";

export type TransientEffectType = "sparkle" | "poof" | "explosion" | "highlight";

/** Canvas-position visual effect that auto-removes after `duration` ms. Not persisted. */
export interface TransientEffect {
  type: TransientEffectType;
  x: number;
  y: number;
  duration: number;
}

export interface SfxEffect {
  id: string;
  label: string;
  emoji: string;
}

export const SFX_EFFECTS: readonly SfxEffect[] = [
  { id: "rimshot", label: "Ba-dum-tss!", emoji: "🥁" },
  { id: "record-scratch", label: "Scratch!", emoji: "📻" },
  { id: "thunder", label: "THUNDER!", emoji: "⚡" },
  { id: "sad-trombone", label: "Womp womp", emoji: "🎺" },
  { id: "applause", label: "Applause!", emoji: "👏" },
  { id: "doorbell", label: "Ding-dong!", emoji: "🔔" },
  { id: "dramatic-sting", label: "Dun-dun-DUN!", emoji: "🎼" },
  { id: "crickets", label: "...*chirp*...", emoji: "🦗" },
] as const;

/** One step in a choreographed sequence. delayMs is cumulative from sequence start. */
export interface ChoreographyStep {
  objectId: string;
  action: "move" | "effect";
  x?: number;
  y?: number;
  effect?: EffectType;
  delayMs: number;
}

export type SceneMood = "comedy" | "noir" | "horror" | "romance" | "tension" | "triumph" | "chaos" | "neutral";

/** Mutation messages the Board DO can receive (excludes cursor) */
export type BoardMutation =
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: BoardObjectUpdate; anim?: { duration: number } }
  | { type: "obj:delete"; id: string }
  | { type: "obj:effect"; id: string; effect: EffectType }
  | { type: "obj:sequence"; steps: ChoreographyStep[] }
  | { type: "obj:transient"; effect: TransientEffect }
  | { type: "spotlight"; objectId?: string; x?: number; y?: number }
  | { type: "blackout" }
  | { type: "sfx"; effect: string; x: number; y: number }
  | { type: "mood"; mood: SceneMood; intensity: number };

export type WSClientMessage =
  | { type: "cursor"; x: number; y: number }
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: BoardObjectUpdate; anim?: { duration: number } }
  | { type: "obj:delete"; id: string }
  | { type: "text:cursor"; objectId: string; position: number }
  | { type: "text:blur"; objectId: string }
  | { type: "batch:undo"; batchId: string }
  | { type: "reaction"; emoji: string; x: number; y: number }
  | { type: "heckle"; text: string }
  | { type: "chat:bubble"; text: string }
  | { type: "obj:effect"; id: string; effect: EffectType }
  | { type: "obj:transient"; effect: TransientEffect }
  | { type: "obj:sequence"; steps: ChoreographyStep[] }
  | { type: "spotlight"; objectId?: string; x?: number; y?: number }
  | { type: "blackout" }
  | { type: "sfx"; effect: string; x: number; y: number }
  | { type: "mood"; mood: SceneMood; intensity: number }
  | { type: "poll:vote"; pollId: string; optionId: string };

/** Visual effect triggered by a collective audience wave */
export type WaveEffect = "confetti" | "shake" | "glow" | "spotlight" | "hearts" | "dramatic";

export type WSServerMessage =
  | { type: "cursor"; userId: string; username: string; x: number; y: number }
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: BoardObject; anim?: { duration: number } }
  | { type: "obj:delete"; id: string }
  | {
      type: "presence";
      users: { id: string; username: string }[];
      spectatorCount: number;
      spectators?: { id: string; username: string }[];
    }
  | { type: "identity"; userId: string; username: string }
  | { type: "init"; objects: BoardObject[] }
  | { type: "board:deleted" }
  | { type: "text:cursor"; userId: string; username: string; objectId: string; position: number }
  | { type: "text:blur"; userId: string; objectId: string }
  | { type: "reaction"; userId: string; emoji: string; x: number; y: number }
  | { type: "heckle"; userId: string; text: string }
  | { type: "chat:bubble"; userId: string; username: string; text: string }
  | { type: "obj:effect"; id: string; effect: EffectType }
  | { type: "obj:transient"; effect: TransientEffect }
  | { type: "obj:sequence"; steps: ChoreographyStep[] }
  | { type: "spotlight"; objectId?: string; x?: number; y?: number }
  | { type: "blackout" }
  | { type: "sfx"; userId: string; effect: string; x: number; y: number }
  | { type: "curtain_call"; characters: { id: string; name: string }[]; sceneTitle: string }
  | { type: "mood"; mood: SceneMood; intensity: number }
  | { type: "audience:wave"; emoji: string; count: number; effect: WaveEffect }
  | { type: "poll:start"; poll: Poll }
  | { type: "poll:result"; result: PollResult };

export const AI_USER_ID = "ai-agent" as const;
export const AI_USERNAME = "AI Assistant" as const;

/** Custom AI persona stored in D1 per board */
export interface Persona {
  id: string;
  name: string;
  trait: string; // personality description used in system prompt
  color: string; // hex color for display
}

/** Default personas used when no custom personas exist for a board */
export const DEFAULT_PERSONAS: readonly Persona[] = [
  {
    id: "default-spark",
    name: "SPARK",
    trait: `You are SPARK - bold, chaotic, theatrical. Red stickies (#f87171).
Rules: escalate by one notch, introduce antagonists and ticking clocks, create dramatic irony.
Voice: punchy one-liners. "The floor just caught fire. You're welcome."`,
    color: "#fb923c",
  },
  {
    id: "default-sage",
    name: "SAGE",
    trait: `You are SAGE - thoughtful, connective, wry. Green (#4ade80) and blue (#60a5fa) stickies.
Rules: find emotional cores, connect unrelated elements, add backstory and hidden depths.
Voice: dry observations. "...but what if the fire is lonely?"`,
    color: "#4ade80",
  },
] as const;

/** One AI persona slot in the troupe with its assigned model */
export interface TroupeMember {
  personaId: string;
  model: AIModel;
  nickname?: string;
}

/** Player-configured AI cast for a scene - set at scene start via OnboardModal */
export interface TroupeConfig {
  members: TroupeMember[];
  stageManagerModel?: AIModel;
}

/** Max human turns per scene before AI wraps up */
export const SCENE_TURN_BUDGET = 20;

export type GameMode = "freeform" | "yesand" | "harold";

/** Explicit scene lifecycle phases with AI-directed transitions */
export type SceneLifecyclePhase = "establish" | "build" | "peak" | "resolve" | "curtain";

export const GAME_MODES = [
  {
    mode: "yesand" as const,
    label: "Yes-And Chain",
    icon: "\uD83D\uDD17",
    description: "Build a 10-beat chain",
    difficulty: "beginner" as const,
  },
  {
    mode: "freeform" as const,
    label: "Freeform",
    icon: "\u2728",
    description: "Classic improv - no rules, just play",
    difficulty: "mid" as const,
  },
  {
    mode: "harold" as const,
    label: "Harold",
    icon: "\uD83C\uDFAD",
    description: "Long-form: opening, beats, callbacks",
    difficulty: "advanced" as const,
  },
] as const;

/** Short ID used as the client-side state value for the model selector */
export type AIModel =
  | "gpt-4o-mini"
  | "gpt-4o"
  | "gpt-5-mini"
  | "claude-haiku-4.5"
  | "claude-sonnet-4"
  | "claude-sonnet-4.6";

export type AIModelProvider = "workers-ai" | "openai" | "anthropic";

/** All selectable AI models across providers. modelId is the provider-specific model identifier. */
export const AI_MODELS = [
  { id: "gpt-4o-mini" as const, label: "GPT-4o Mini", provider: "openai" as const, modelId: "gpt-4o-mini" },
  { id: "gpt-4o" as const, label: "GPT-4o", provider: "openai" as const, modelId: "gpt-4o" },
  { id: "gpt-5-mini" as const, label: "GPT-5 Mini", provider: "openai" as const, modelId: "gpt-5-mini" },
  {
    id: "claude-haiku-4.5" as const,
    label: "Claude Haiku 4.5",
    provider: "anthropic" as const,
    modelId: "claude-haiku-4-5-20251001",
  },
  {
    id: "claude-sonnet-4" as const,
    label: "Claude Sonnet 4",
    provider: "anthropic" as const,
    modelId: "claude-sonnet-4-20250514",
  },
  {
    id: "claude-sonnet-4.6" as const,
    label: "Claude Sonnet 4.6",
    provider: "anthropic" as const,
    modelId: "claude-sonnet-4-6",
  },
] as const;

export interface DailyChallenge {
  id: number;
  date: string;
  prompt: string;
  /** Optional board template ID for pre-seeded canvas objects */
  templateId?: string | null;
  /** Game mode for the challenge board (freeform | hat | yesand) */
  gameMode: string;
  /** null when user has not entered; always present in authenticated responses */
  userBoardId: string | null;
  /** User's current consecutive-day challenge streak (0 or absent = no streak) */
  streak?: number;
  /** User's personal best critic_score (1-5) across all prior challenge attempts */
  bestScore?: number | null;
}

export interface LeaderboardEntry {
  boardId: string;
  /** Used for current-user highlighting; compare to AuthUser.id, not displayName */
  userId: string;
  username: string;
  /** Kept for backward compat; leaderboard now primarily sorts by criticScore when present */
  reactionCount: number;
  /** Board name for this entry (shown as scene subtitle) */
  sceneName?: string | null;
  /** AI critic star rating 1-5; absent until scene is reviewed at dramatic conclusion */
  criticScore?: number | null;
  /** AI critic review snippet; absent until scene is reviewed */
  criticReview?: string | null;
}

export interface ReplayEvent {
  type: "obj:create" | "obj:update" | "obj:delete";
  ts: number;
  obj?: BoardObject; // present for create/update
  id?: string; // present for delete
  anim?: { duration: number }; // ephemeral animation hint, not persisted to obj storage
}

/** Result from Board DO mutations (mutate RPC) */
export type MutateResult = { ok: boolean; error?: string };

/** Scene-scoped character relationship for narrative coherence tracking */
export interface CharacterRelationship {
  entityA: string;
  entityB: string;
  descriptor: string;
  updatedAt: number;
}

/** Canvas usable area bounds - keep in sync with LAYOUT RULES in prompts.ts. */
export const CANVAS_MIN_X = 50;
export const CANVAS_MIN_Y = 60;
export const CANVAS_MAX_X = 1150;
export const CANVAS_MAX_Y = 780;

export interface PollOption {
  id: string;
  label: string;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  expiresAt: number;
}

export interface PollResult {
  pollId: string;
  question: string;
  options: PollOption[]; // all options (for display labels)
  winner: PollOption;
  votes: Record<string, number>; // optionId -> vote count
  totalVotes: number;
}

/**
 * Minimal interface for the Board DO stub methods used by AI tools.
 * mutate() intentionally narrows to BoardMutation (vs WSClientMessage in Board DO)
 * for AI tool safety - prevents tools from sending cursor/reaction messages.
 */
export interface BoardStub {
  readObjects(): Promise<BoardObject[]>;
  readObject(id: string): Promise<BoardObject | null>;
  mutate(msg: BoardMutation): Promise<MutateResult>;
  injectCursor(x: number, y: number): Promise<void>;
  saveCriticReview(review: string, score: number, model: string): Promise<void>;
  createPoll(question: string, options: PollOption[]): Promise<{ ok: boolean; error?: string }>;
}

/** Canvas mutation notification sent from Board DO to ChatAgent after each player action */
export interface CanvasAction {
  type: "obj:create" | "obj:update" | "obj:delete";
  userId: string;
  username: string;
  objectType?: BoardObject["type"];
  objectId: string;
  text?: string;
  /** true for creates/deletes/text-edits; false for position/size drags */
  significant: boolean;
  ts: number;
}
