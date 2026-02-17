import { useRef, useCallback } from "react";
import type { BoardObject } from "@shared/types";

type UndoableAction =
  | { type: "create"; obj: BoardObject }
  | { type: "update"; before: BoardObject; after: BoardObject }
  | { type: "delete"; obj: BoardObject };

const MAX_UNDO = 50;

/** Deep-clone a BoardObject (one level into props) */
const snapshot = (obj: BoardObject): BoardObject => ({ ...obj, props: { ...obj.props } });

export function useUndoRedo(
  objects: Map<string, BoardObject>,
  wsCreate: (obj: BoardObject) => void,
  wsUpdate: (partial: Partial<BoardObject> & { id: string }) => void,
  wsDelete: (id: string) => void,
) {
  const stackRef = useRef<UndoableAction[]>([]);
  const indexRef = useRef(-1);
  const replayingRef = useRef(false);
  // Ref avoids objects Map in useCallback deps (would destabilize every render)
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  const push = useCallback((action: UndoableAction) => {
    // Trim any redo history beyond current index
    stackRef.current = stackRef.current.slice(0, indexRef.current + 1);
    stackRef.current.push(action);
    if (stackRef.current.length > MAX_UNDO) {
      stackRef.current = stackRef.current.slice(stackRef.current.length - MAX_UNDO);
    }
    indexRef.current = stackRef.current.length - 1;
  }, []);

  const createObject = useCallback(
    (obj: BoardObject) => {
      if (!replayingRef.current) push({ type: "create", obj: snapshot(obj) });
      wsCreate(obj);
    },
    [wsCreate, push],
  );

  const updateObject = useCallback(
    (partial: Partial<BoardObject> & { id: string }) => {
      if (!replayingRef.current) {
        const before = objectsRef.current.get(partial.id);
        if (before) {
          const after = { ...before, ...partial, props: { ...before.props, ...partial.props } };
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
        if (obj) push({ type: "delete", obj: snapshot(obj) });
      }
      wsDelete(id);
    },
    [wsDelete, push],
  );

  const undo = useCallback(() => {
    if (indexRef.current < 0) return;
    const action = stackRef.current[indexRef.current];
    indexRef.current--;
    replayingRef.current = true;
    try {
      switch (action.type) {
        case "create":
          wsDelete(action.obj.id);
          break;
        case "update":
          wsUpdate(action.before);
          break;
        case "delete":
          wsCreate(action.obj);
          break;
      }
    } finally {
      replayingRef.current = false;
    }
  }, [wsCreate, wsUpdate, wsDelete]);

  const redo = useCallback(() => {
    if (indexRef.current >= stackRef.current.length - 1) return;
    indexRef.current++;
    const action = stackRef.current[indexRef.current];
    replayingRef.current = true;
    try {
      switch (action.type) {
        case "create":
          wsCreate(action.obj);
          break;
        case "update":
          wsUpdate(action.after);
          break;
        case "delete":
          wsDelete(action.obj.id);
          break;
      }
    } finally {
      replayingRef.current = false;
    }
  }, [wsCreate, wsUpdate, wsDelete]);

  return { createObject, updateObject, deleteObject, undo, redo };
}
