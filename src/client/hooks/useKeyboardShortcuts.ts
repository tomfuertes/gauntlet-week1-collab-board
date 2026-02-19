import type React from "react";
import { useEffect } from "react";
import type { ToolMode } from "../components/Toolbar";

interface UseKeyboardShortcutsParams {
  selectedIds: Set<string>;
  editingId: string | null;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setToolMode: React.Dispatch<React.SetStateAction<ToolMode>>;
  setChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
  deleteSelected: () => void;
  copySelected: () => void;
  pasteClipboard: () => void;
  duplicateSelected: () => void;
  undo: () => void;
  redo: () => void;
}

export function useKeyboardShortcuts({
  selectedIds,
  editingId,
  setSelectedIds,
  setToolMode,
  setChatOpen,
  setShowShortcuts,
  deleteSelected,
  copySelected,
  pasteClipboard,
  duplicateSelected,
  undo,
  redo,
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") { setSelectedIds(new Set()); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") { e.preventDefault(); redo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "c") { if (selectedIds.size > 0) e.preventDefault(); copySelected(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "v") { e.preventDefault(); pasteClipboard(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "d") { if (selectedIds.size > 0) e.preventDefault(); duplicateSelected(); return; }
      if (e.key === "v" || e.key === "V") setToolMode("select");
      if (e.key === "s" || e.key === "S") setToolMode("sticky");
      if (e.key === "r" || e.key === "R") setToolMode("rect");
      if (e.key === "c" || e.key === "C") setToolMode("circle");
      if (e.key === "l" || e.key === "L") setToolMode("line");
      if (e.key === "a" || e.key === "A") setToolMode("arrow");
      if (e.key === "t" || e.key === "T") setToolMode("text");
      if (e.key === "f" || e.key === "F") setToolMode("frame");
      if (e.key === "/") { e.preventDefault(); setChatOpen((o) => !o); }
      if (e.key === "?") { e.preventDefault(); setShowShortcuts((o) => !o); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0 && !editingId) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, editingId, deleteSelected, copySelected, pasteClipboard, duplicateSelected, undo, redo, setSelectedIds, setToolMode, setChatOpen, setShowShortcuts]);
}
