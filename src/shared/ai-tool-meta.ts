/** Tool display metadata - shared between server (SSE events) and client (ChatPanel) */

import type { ToolName } from "../server/ai-tools-sdk";
export type { ToolName };

export const TOOL_ICONS: Record<ToolName, string> = {
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
  generateImage: "\u{2728}",
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
  generateImage: "Generating image",
};

/** Lookup icon by dynamic string key (SSE events have untyped name) */
export function getToolIcon(name: string): string {
  return TOOL_ICONS[name as ToolName] || "\u{1F527}";
}

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
    case "generateImage": return `Generated image: "${a.prompt || "..."}"`;
    default: return t.label;
  }
}
