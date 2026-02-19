// Shared visual constants for consistent styling across all components

export const colors = {
  // Accent (indigo-500 family)
  accent: "#6366f1",
  accentLight: "#818cf8",
  accentDark: "#4f46e5",
  accentGlow: "rgba(99, 102, 241, 0.3)",
  accentSubtle: "rgba(99, 102, 241, 0.12)",

  // Surfaces
  bg: "#1a1a2e",
  surface: "#16213e",
  surfaceAlt: "#0f172a",
  overlay: "rgba(22, 33, 62, 0.95)",
  overlayHeader: "rgba(22, 33, 62, 0.9)",

  // Borders
  border: "#334155",
  borderLight: "#475569",

  // Text
  text: "#eee",
  textMuted: "#94a3b8",
  textDim: "#888",
  textSubtle: "#64748b",

  // Status (semantic - keep distinct from accent)
  success: "#4ade80",
  warning: "#facc15",
  error: "#f87171",
  info: "#94a3b8",

  // AI presence
  aiCursor: "#38bdf8", // sky-400 - distinct AI indicator
} as const;

// Stable color per userId via hash (same palette across Board, ChatPanel, Cursors)
const CURSOR_COLORS = [
  "#f87171",
  "#60a5fa",
  "#4ade80",
  "#fbbf24",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fb923c",
  "#818cf8",
  "#22d3ee",
] as const;

export function getUserColor(userId: string): string {
  const hash = userId.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

// CSS cursor per tool mode
export const toolCursors: Record<string, string> = {
  select: "default",
  sticky: "crosshair",
  rect: "crosshair",
  circle: "crosshair",
  line: "crosshair",
  arrow: "crosshair",
  text: "text",
  frame: "crosshair",
};
