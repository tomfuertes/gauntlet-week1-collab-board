/** Tool display metadata - shared between server (SSE events) and client (ChatPanel) */

export const TOOL_NAMES = [
  "createStickyNote",
  "createShape",
  "createFrame",
  "createConnector",
  "moveObject",
  "resizeObject",
  "updateText",
  "changeColor",
  "getBoardState",
  "deleteObject",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Emoji icons for tool display in ChatPanel. Typed as string-indexed for dynamic SSE lookups. */
export const TOOL_ICONS: Record<string, string> = {
  createStickyNote: "\u{1F4CC}",
  createShape: "\u{1F7E6}",
  createFrame: "\u{1F5BC}",
  createConnector: "\u{27A1}",
  moveObject: "\u{1F4CD}",
  resizeObject: "\u{2194}",
  updateText: "\u{270F}",
  changeColor: "\u{1F3A8}",
  getBoardState: "\u{1F440}",
  deleteObject: "\u{1F5D1}",
};

export const TOOL_LABELS: Record<ToolName, string> = {
  createStickyNote: "Creating sticky",
  createShape: "Creating shape",
  createFrame: "Creating frame",
  createConnector: "Connecting objects",
  moveObject: "Moving object",
  resizeObject: "Resizing object",
  updateText: "Updating text",
  changeColor: "Changing color",
  getBoardState: "Reading board",
  deleteObject: "Deleting object",
};

/** Human-readable summary of a tool invocation for ChatPanel display */
export function toolSummary(t: { name: string; label: string; args?: Record<string, unknown> }): string {
  const a = t.args || {};
  switch (t.name) {
    case "createStickyNote": return `Created sticky: "${a.text || "..."}"`;
    case "createShape": return `Drew ${a.shape || "shape"}${a.fill ? ` (${a.fill})` : ""}`;
    case "createFrame": return `Created frame: "${a.title || "..."}"`;
    case "createConnector": return "Connected objects";
    case "moveObject": return "Moved object";
    case "resizeObject": return "Resized object";
    case "updateText": return `Updated text: "${a.text || "..."}"`;
    case "changeColor": return `Changed color to ${a.color || "..."}`;
    case "getBoardState": return `Read board${a.filter ? ` (${a.filter}s)` : ""}`;
    case "deleteObject": return "Deleted object";
    default: return t.label;
  }
}
