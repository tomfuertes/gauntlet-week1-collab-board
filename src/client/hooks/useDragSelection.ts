import { useState, useRef, useCallback } from "react";
import type { BoardObject } from "@shared/types";

export type MarqueeRect = { x: number; y: number; w: number; h: number };

/** Check if two axis-aligned bounding boxes intersect */
function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.w > b.x && a.y < b.y + b.height && a.y + a.h > b.y;
}

interface UseDragSelectionParams {
  objectsRef: React.RefObject<Map<string, BoardObject>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useDragSelection({ objectsRef, setSelectedIds }: UseDragSelectionParams) {
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingMarqueeRef = useRef(false);
  const justFinishedMarqueeRef = useRef(false);

  const startMarquee = useCallback((worldX: number, worldY: number) => {
    marqueeStartRef.current = { x: worldX, y: worldY };
    isDraggingMarqueeRef.current = true;
  }, []);

  const updateMarquee = useCallback((worldX: number, worldY: number) => {
    if (!isDraggingMarqueeRef.current || !marqueeStartRef.current) return;
    const start = marqueeStartRef.current;
    setMarquee({
      x: Math.min(start.x, worldX),
      y: Math.min(start.y, worldY),
      w: Math.abs(worldX - start.x),
      h: Math.abs(worldY - start.y),
    });
  }, []);

  /** Finish marquee selection. Returns true if a marquee was active (caller should skip other mouseup logic). */
  const finishMarquee = useCallback((): boolean => {
    if (!isDraggingMarqueeRef.current) return false;
    isDraggingMarqueeRef.current = false;

    const m = marqueeRef.current;
    if (m && (m.w > 5 || m.h > 5)) {
      const selected = new Set<string>();
      if (!objectsRef.current) return true;
      for (const obj of objectsRef.current.values()) {
        // Lines/connectors store directional deltas - normalize to positive AABB
        const bounds =
          obj.type === "line"
            ? {
                x: Math.min(obj.x, obj.x + obj.width),
                y: Math.min(obj.y, obj.y + obj.height),
                width: Math.abs(obj.width),
                height: Math.abs(obj.height),
              }
            : obj;
        if (!obj.isBackground && rectsIntersect(m, bounds)) {
          selected.add(obj.id);
        }
      }
      setSelectedIds(selected);
      justFinishedMarqueeRef.current = true;
    }
    setMarquee(null);
    marqueeStartRef.current = null;
    return true;
  }, [objectsRef, setSelectedIds]);

  return {
    marquee,
    justFinishedMarqueeRef,
    startMarquee,
    updateMarquee,
    finishMarquee,
  };
}
