import { useRef, useCallback } from "react";
import type { BoardObject, BoardObjectUpdate } from "@shared/types";

type UndoableAction =
  | { type: "create"; obj: BoardObject }
  | { type: "update"; before: BoardObject; after: BoardObject }
  | { type: "delete"; obj: BoardObject }
  | { type: "batch"; actions: UndoableAction[]; tag?: string };

const MAX_UNDO = 50;

/** Deep-clone a BoardObject (one level into props). Cast safe: spread preserves structure. */
const snapshot = (obj: BoardObject): BoardObject => ({ ...obj, props: { ...obj.props } }) as BoardObject;

export function useUndoRedo(
  objects: Map<string, BoardObject>,
  wsCreate: (obj: BoardObject) => void,
  wsUpdate: (partial: BoardObjectUpdate) => void,
  wsDelete: (id: string) => void,
) {
  const stackRef = useRef<UndoableAction[]>([]);
  const indexRef = useRef(-1);
  const replayingRef = useRef(false);
  const batchRef = useRef<UndoableAction[] | null>(null);
  // Ref avoids objects Map in useCallback deps (would destabilize every render)
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  /** Replay an action (or batch of actions) for undo or redo */
  const replayAction = useCallback(
    (action: UndoableAction, direction: "undo" | "redo") => {
      if (action.type === "batch") {
        const items = direction === "undo" ? [...action.actions].reverse() : action.actions;
        for (const sub of items) {
          try {
            replayAction(sub, direction);
          } catch (err) {
            console.error(`[useUndoRedo] batch ${direction} failed on sub-action type=${sub.type}:`, err);
            throw err;
          }
        }
        return;
      }
      switch (action.type) {
        case "create":
          if (direction === "undo") wsDelete(action.obj.id);
          else wsCreate(action.obj);
          break;
        case "update":
          wsUpdate(direction === "undo" ? action.before : action.after);
          break;
        case "delete":
          if (direction === "undo") wsCreate(action.obj);
          else wsDelete(action.obj.id);
          break;
      }
    },
    [wsCreate, wsUpdate, wsDelete],
  );

  const push = useCallback((action: UndoableAction) => {
    if (batchRef.current) {
      batchRef.current.push(action);
      return;
    }
    // Trim any redo history beyond current index
    stackRef.current = stackRef.current.slice(0, indexRef.current + 1);
    stackRef.current.push(action);
    if (stackRef.current.length > MAX_UNDO) {
      stackRef.current = stackRef.current.slice(stackRef.current.length - MAX_UNDO);
    }
    indexRef.current = stackRef.current.length - 1;
  }, []);

  const startBatch = useCallback(() => {
    if (batchRef.current) {
      console.error("[useUndoRedo] startBatch called while batch already open - committing previous");
      // Inline commit to avoid circular dependency with commitBatch
      const leaked = batchRef.current;
      batchRef.current = null;
      if (leaked.length === 1) push(leaked[0]);
      else if (leaked.length > 1) push({ type: "batch", actions: leaked });
    }
    batchRef.current = [];
  }, [push]);

  const commitBatch = useCallback(() => {
    const actions = batchRef.current;
    batchRef.current = null;
    if (!actions || actions.length === 0) return;
    if (actions.length === 1) {
      push(actions[0]);
    } else {
      push({ type: "batch", actions });
    }
  }, [push]);

  const createObject = useCallback(
    (obj: BoardObject) => {
      if (!replayingRef.current) push({ type: "create", obj: snapshot(obj) });
      wsCreate(obj);
    },
    [wsCreate, push],
  );

  const updateObject = useCallback(
    (partial: BoardObjectUpdate) => {
      if (!replayingRef.current) {
        const before = objectsRef.current.get(partial.id);
        if (before) {
          // Cast safe: merging into valid BoardObject preserves discriminant
          const after = { ...before, ...partial, props: { ...before.props, ...(partial.props || {}) } } as BoardObject;
          push({ type: "update", before: snapshot(before), after: snapshot(after) });
        }
      }
      wsUpdate(partial);
    },
    [wsUpdate, push],
  );

  const deleteObject = useCallback(
    (id: string) => {
      if (!replayingRef.current) {
        const obj = objectsRef.current.get(id);
        if (obj) {
          push({ type: "delete", obj: snapshot(obj) });
        } else {
          console.warn(`[useUndoRedo] deleteObject: object ${id} not in local state - no undo entry`);
        }
      }
      wsDelete(id);
    },
    [wsDelete, push],
  );

  const undo = useCallback(() => {
    if (indexRef.current < 0) return;
    const action = stackRef.current[indexRef.current];
    replayingRef.current = true;
    try {
      replayAction(action, "undo");
      indexRef.current--;
    } finally {
      replayingRef.current = false;
    }
  }, [replayAction]);

  const redo = useCallback(() => {
    if (indexRef.current >= stackRef.current.length - 1) return;
    const action = stackRef.current[indexRef.current + 1];
    replayingRef.current = true;
    try {
      replayAction(action, "redo");
      indexRef.current++;
    } finally {
      replayingRef.current = false;
    }
  }, [replayAction]);

  /** Push externally-created objects (e.g. from AI via WS) to the undo stack without re-creating them */
  const pushExternalBatch = useCallback(
    (objs: BoardObject[], tag?: string) => {
      if (objs.length === 0) return;
      const actions: UndoableAction[] = objs.map((obj) => ({ type: "create" as const, obj: snapshot(obj) }));
      if (actions.length === 1) {
        push(actions[0]);
      } else {
        push({ type: "batch", actions, tag });
      }
    },
    [push],
  );

  /** Check if the top of the undo stack has a matching tag (for targeted undo) */
  const topTag = useCallback((): string | undefined => {
    if (indexRef.current < 0) return undefined;
    const action = stackRef.current[indexRef.current];
    return action.type === "batch" ? action.tag : undefined;
  }, []);

  return { createObject, updateObject, deleteObject, startBatch, commitBatch, undo, redo, pushExternalBatch, topTag };
}
