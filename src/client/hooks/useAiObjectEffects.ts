import { useState, useRef, useEffect } from "react";
import { AI_USER_ID } from "@shared/types";
import type { BoardObject } from "@shared/types";

const AI_GLOW_DURATION_MS = 10_000;
const AI_CONFETTI_THRESHOLD = 3;
const AI_CONFETTI_WINDOW_MS = 2_000;

/**
 * Tracks AI-created objects for glow effects and confetti bursts.
 * Extracted from Board.tsx to isolate AI visual feedback logic.
 *
 * Returns aiGlowIds (Set of object IDs currently glowing),
 * confettiPos (burst coordinates or null), confettiKey (trigger counter),
 * and clearConfetti (callback to dismiss burst).
 */
export function useAiObjectEffects(
  objects: Map<string, BoardObject>,
  initialized: boolean,
  scale: number,
  stagePos: { x: number; y: number },
  size: { width: number; height: number },
) {
  // Confetti state (re-triggerable via key counter)
  const [confettiPos, setConfettiPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [confettiKey, setConfettiKey] = useState(0);
  const initObjectCount = useRef<number | null>(null);
  const firstConfettiFired = useRef(false);

  // AI object tracking for confetti + glow
  const prevObjectIdsRef = useRef<Set<string>>(new Set());
  const aiCreateTimestamps = useRef<{ ts: number; x: number; y: number }[]>([]);
  const [aiGlowIds, setAiGlowIds] = useState<Set<string>>(new Set());
  const glowTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // AI cursor target - world coords of most recently created AI object
  const [aiCursorTarget, setAiCursorTarget] = useState<{ x: number; y: number } | null>(null);
  const aiCursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel all timers on unmount
  useEffect(() => {
    return () => {
      for (const t of glowTimersRef.current) clearTimeout(t);
      glowTimersRef.current = [];
      if (aiCursorTimerRef.current) clearTimeout(aiCursorTimerRef.current);
    };
  }, []);

  // Confetti trigger: first object on an empty board
  useEffect(() => {
    if (initObjectCount.current === null && initialized) {
      initObjectCount.current = objects.size;
    }
    if (initObjectCount.current !== 0 || firstConfettiFired.current) return;
    if (objects.size > 0) {
      firstConfettiFired.current = true;
      setConfettiPos({ x: size.width / 2, y: size.height / 2 });
      setConfettiKey((k) => k + 1);
    }
  }, [objects.size, size.width, size.height, initialized]);

  // Detect new AI-created objects for confetti + glow
  useEffect(() => {
    if (!initialized) return;
    const currentIds = new Set(objects.keys());
    const prevIds = prevObjectIdsRef.current;

    // Find new object IDs
    const newAiObjects: { id: string; x: number; y: number }[] = [];
    for (const id of currentIds) {
      if (!prevIds.has(id)) {
        const obj = objects.get(id);
        if (obj && obj.createdBy === AI_USER_ID) {
          newAiObjects.push({
            id,
            x: obj.x + obj.width / 2,
            y: obj.y + obj.height / 2,
          });
        }
      }
    }
    prevObjectIdsRef.current = currentIds;

    if (newAiObjects.length === 0) return;

    // Update AI cursor target to the last created object's center (world coords)
    const last = newAiObjects[newAiObjects.length - 1];
    setAiCursorTarget({ x: last.x, y: last.y });
    if (aiCursorTimerRef.current) clearTimeout(aiCursorTimerRef.current);
    // Clear target after 1s of inactivity; AiCursor fades out 500ms after null
    aiCursorTimerRef.current = setTimeout(() => setAiCursorTarget(null), 1000);

    // Remove IDs from aiGlowIds after timeout; visual fade is applied by Board.tsx
    const newGlowIds = newAiObjects.map((o) => o.id);
    setAiGlowIds((prev) => {
      const next = new Set(prev);
      for (const id of newGlowIds) next.add(id);
      return next;
    });
    const timer = setTimeout(() => {
      setAiGlowIds((prev) => {
        const next = new Set(prev);
        for (const id of newGlowIds) next.delete(id);
        return next;
      });
      // Prune expired handle so the array doesn't grow unboundedly in long sessions
      glowTimersRef.current = glowTimersRef.current.filter((t) => t !== timer);
    }, AI_GLOW_DURATION_MS);
    glowTimersRef.current.push(timer);

    // Track timestamps for multi-create confetti
    const now = Date.now();
    for (const o of newAiObjects) {
      aiCreateTimestamps.current.push({ ts: now, x: o.x, y: o.y });
    }
    // Prune entries older than window
    aiCreateTimestamps.current = aiCreateTimestamps.current.filter((e) => now - e.ts < AI_CONFETTI_WINDOW_MS);

    // Fire confetti if threshold met within window
    if (aiCreateTimestamps.current.length >= AI_CONFETTI_THRESHOLD) {
      const entries = aiCreateTimestamps.current;
      const cx = entries.reduce((s, e) => s + e.x, 0) / entries.length;
      const cy = entries.reduce((s, e) => s + e.y, 0) / entries.length;
      // Convert world coords to screen coords
      const screenX = cx * scale + stagePos.x;
      const screenY = cy * scale + stagePos.y;
      setConfettiPos({ x: screenX, y: screenY });
      setConfettiKey((k) => k + 1);
      aiCreateTimestamps.current = [];
    }
  }, [objects, initialized, scale, stagePos]);

  return { aiGlowIds, confettiPos, confettiKey, clearConfetti: () => setConfettiPos(null), aiCursorTarget };
}
