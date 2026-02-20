// Shared rendering defaults for board objects - used by Board.tsx and ReplayViewer.tsx
export const OBJECT_DEFAULTS = {
  rect: { fill: "#3b82f6", stroke: "#2563eb" },
  circle: { fill: "#8b5cf6", stroke: "#7c3aed" },
  line: { stroke: "#f43f5e" },
  sticky: { color: "#fbbf24" },
  text: { color: "#ffffff" },
  person: { color: "#6366f1" }, // indigo; AI personas use SPARK=#fb923c, SAGE=#4ade80
} as const;

// Konva Transformer configuration - extracted from Board.tsx
export const TRANSFORMER_CONFIG = {
  flipEnabled: false,
  rotateEnabled: true,
  anchorFill: "#fff",
  anchorSize: 8,
  padding: 5,
  anchorCornerRadius: 2,
} as const;
