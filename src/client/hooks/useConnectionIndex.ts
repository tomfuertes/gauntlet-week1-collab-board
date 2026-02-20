import { useMemo } from "react";
import type { BoardObject } from "@shared/types";

/**
 * Reverse index: objectId -> lineIds connected to it.
 * Used by drag handlers to find which lines need updating when an object moves.
 */
export function useConnectionIndex(objects: Map<string, BoardObject>): Map<string, string[]> {
  return useMemo(() => {
    const index = new Map<string, string[]>();
    for (const [, obj] of objects) {
      if (obj.type !== "line") continue;
      if (obj.startObjectId) {
        const list = index.get(obj.startObjectId) || [];
        list.push(obj.id);
        index.set(obj.startObjectId, list);
      }
      if (obj.endObjectId) {
        const list = index.get(obj.endObjectId) || [];
        list.push(obj.id);
        index.set(obj.endObjectId, list);
      }
    }
    return index;
  }, [objects]);
}
