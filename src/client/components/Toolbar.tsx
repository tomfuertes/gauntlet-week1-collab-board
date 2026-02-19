import React, { useState } from "react";
import type { BoardObject } from "@shared/types";
import { colors } from "../theme";

export type ToolMode = "select" | "sticky" | "rect" | "circle" | "line" | "arrow" | "text" | "frame";

export const COLOR_PRESETS = [
  "#fbbf24", // amber (sticky default)
  "#f87171", // red
  "#fb923c", // orange
  "#4ade80", // green
  "#3b82f6", // blue (rect default)
  "#a78bfa", // purple
  "#f472b6", // pink
  "#94a3b8", // slate
];

export const TOOLBAR_H = 46; // 36px icons + 8px padding + 2px border

export interface ToolbarProps {
  toolMode: ToolMode;
  setToolMode: React.Dispatch<React.SetStateAction<ToolMode>>;
  selectedIds: Set<string>;
  objects: Map<string, BoardObject>;
  chatOpen: boolean;
  setChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showShortcuts: boolean;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
  deleteSelected: () => void;
  onColorChange: (color: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function Toolbar({
  toolMode, setToolMode, selectedIds, objects, chatOpen, setChatOpen,
  showShortcuts, setShowShortcuts,
  deleteSelected, onColorChange, onZoomIn, onZoomOut, onZoomReset,
}: ToolbarProps) {
  // Color picker state
  const firstId = selectedIds.size > 0 ? [...selectedIds][0] : undefined;
  const firstObj = firstId ? objects.get(firstId) : undefined;
  const showColorPicker = firstObj && firstObj.type !== "frame";
  const currentColor = firstObj
    ? firstObj.props[firstObj.type === "sticky" || firstObj.type === "text" ? "color" : firstObj.type === "line" ? "stroke" : "fill"]
    : undefined;

  return (
    <>
      {/* Floating Toolbar - Bottom Center */}
      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 20,
        background: "rgba(22, 33, 62, 0.85)", border: `1px solid ${colors.border}`,
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        borderRadius: 999, boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center",
        padding: "4px 8px", gap: 2,
        maxWidth: "calc(100vw - 32px)",
      }}>
        <ToolIconBtn icon={<IconSelect />} title="Select (V)" active={toolMode === "select"} onClick={() => setToolMode("select")} />
        <ToolbarSep />
        <ToolIconBtn icon={<IconSticky />} title="Sticky note (S)" active={toolMode === "sticky"} onClick={() => setToolMode("sticky")} />
        <ToolIconBtn icon={<IconRect />} title="Rectangle (R)" active={toolMode === "rect"} onClick={() => setToolMode("rect")} />
        <ToolIconBtn icon={<IconCircle />} title="Circle (C)" active={toolMode === "circle"} onClick={() => setToolMode("circle")} />
        <ToolIconBtn icon={<IconLine />} title="Line (L)" active={toolMode === "line"} onClick={() => setToolMode("line")} />
        <ToolIconBtn icon={<IconArrow />} title="Arrow (A)" active={toolMode === "arrow"} onClick={() => setToolMode("arrow")} />
        <ToolIconBtn icon={<IconText />} title="Text (T)" active={toolMode === "text"} onClick={() => setToolMode("text")} />
        <ToolIconBtn icon={<IconFrame />} title="Frame (F)" active={toolMode === "frame"} onClick={() => setToolMode("frame")} />
        <ToolbarSep />
        <ToolIconBtn
          icon={<IconDelete />}
          title="Delete selected (Del)"
          active={false}
          onClick={deleteSelected}
          disabled={selectedIds.size === 0}
        />
        <ToolbarSep />
        <ToolIconBtn icon={<IconChat />} title="AI Assistant (/)" active={chatOpen} onClick={() => setChatOpen((o) => !o)} />
      </div>

      {/* Color picker - shown above floating toolbar when objects are selected */}
      {showColorPicker && (
        <div style={{
          position: "absolute", bottom: TOOLBAR_H + 24, left: "50%", transform: "translateX(-50%)",
          display: "flex", gap: 6, zIndex: 20, padding: "6px 10px",
          background: colors.overlayHeader, border: `1px solid ${colors.border}`,
          borderRadius: 999, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}>
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              title={color}
              onClick={() => onColorChange(color)}
              style={{
                width: 28, height: 28, borderRadius: "50%", border: "2px solid",
                borderColor: currentColor === color ? "#fff" : "transparent",
                background: color, cursor: "pointer", padding: 0,
                outline: currentColor === color ? `2px solid ${colors.accent}` : "none",
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
      )}

      {/* Zoom controls - bottom left, above toolbar */}
      <div style={{ position: "absolute", bottom: TOOLBAR_H + 24, left: 16, display: "flex", gap: 4, zIndex: 10 }}>
        <ZoomBtn label="-" onClick={onZoomOut} />
        <ZoomBtn label="Reset" onClick={onZoomReset} />
        <ZoomBtn label="+" onClick={onZoomIn} />
      </div>

      {/* Keyboard shortcut overlay */}
      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
    </>
  );
}

// --- Internal components ---

function ToolIconBtn({ icon, title, active, onClick, disabled }: {
  icon: React.ReactNode; title: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? colors.accent : hovered && !disabled ? colors.accentSubtle : "transparent",
        border: active ? `1px solid ${colors.accentLight}` : "1px solid transparent",
        borderRadius: 6,
        color: disabled ? "#475569" : active ? "#fff" : hovered ? colors.accentLight : colors.textMuted,
        cursor: disabled ? "default" : "pointer", padding: 0,
        transform: hovered && !disabled ? "scale(1.1)" : "scale(1)",
        transition: "transform 0.15s ease, background 0.15s ease, color 0.15s ease",
      }}
    >
      {icon}
    </button>
  );
}

function ToolbarSep() {
  return <div style={{ width: 1, height: 24, background: colors.border, margin: "0 4px", flexShrink: 0 }} />;
}

function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: label === "Reset" ? 52 : 32, height: 32,
      background: "rgba(22, 33, 62, 0.9)", border: "1px solid #334155",
      borderRadius: 4, color: "#eee", cursor: "pointer", fontSize: "0.875rem",
    }}>
      {label}
    </button>
  );
}

// --- Shortcut overlay ---

const SHORTCUTS = [
  ["V", "Select"],
  ["S", "Sticky note"],
  ["R", "Rectangle"],
  ["C", "Circle"],
  ["L", "Line"],
  ["A", "Arrow"],
  ["T", "Text"],
  ["F", "Frame"],
  ["/", "AI Assistant"],
  ["?", "This overlay"],
  ["Del", "Delete selected"],
  ["Esc", "Deselect"],
  ["\u2318Z", "Undo"],
  ["\u2318\u21E7Z", "Redo"],
  ["\u2318C", "Copy"],
  ["\u2318V", "Paste"],
  ["\u2318D", "Duplicate"],
  ["Shift+Click", "Multi-select"],
  ["Dbl-click", "Create object"],
  ["\u21E7P", "Perf overlay"],
] as const;

function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: "1.5rem 2rem", maxWidth: 360, width: "90%",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <span style={{ fontWeight: 600, color: colors.text, fontSize: "1rem" }}>Keyboard Shortcuts</span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: colors.textMuted,
            cursor: "pointer", fontSize: "1.25rem", lineHeight: 1, padding: "0.25rem",
          }}>
            &#x2715;
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px" }}>
          {SHORTCUTS.map(([key, label]) => (
            <React.Fragment key={key}>
              <kbd style={{
                background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
                borderRadius: 4, padding: "2px 8px", fontSize: "0.75rem",
                fontFamily: "inherit", color: colors.accentLight, textAlign: "center",
                minWidth: 32,
              }}>
                {key}
              </kbd>
              <span style={{ color: colors.textMuted, fontSize: "0.8125rem", lineHeight: "24px" }}>
                {label}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Icons ---

function IconSelect() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4l7.07 16.97 2.51-7.39 7.39-2.51L4 4z"/>
      <path d="M13.5 13.5l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

function IconSticky() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8.5L15.5 3z"/>
      <polyline points="14 3 14 9 21 9"/>
    </svg>
  );
}

function IconRect() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
    </svg>
  );
}

function IconCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9"/>
    </svg>
  );
}

function IconLine() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="5" y1="19" x2="19" y2="5"/>
    </svg>
  );
}

function IconArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="19" x2="17" y2="7"/>
      <polyline points="10 7 17 7 17 14"/>
    </svg>
  );
}

function IconText() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  );
}

function IconFrame() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="16" rx="2" strokeDasharray="4 2"/>
      <line x1="3" y1="5" x2="10" y2="5" strokeWidth="2.5"/>
    </svg>
  );
}

function IconDelete() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  );
}
