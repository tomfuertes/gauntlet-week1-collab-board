import { useRef, useCallback } from "react";

// Returns a stable wrapper that calls `fn` at most once per `ms` milliseconds.
// Uses a ref-based timestamp guard (no timers) - fires immediately on first call,
// then drops subsequent calls within the throttle window (leading-edge throttle).
export function useThrottledCallback<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number
): (...args: T) => void {
  const lastRef = useRef(0);
  return useCallback(
    (...args: T) => {
      const now = Date.now();
      if (now - lastRef.current < ms) return;
      lastRef.current = now;
      fn(...args);
    },
    [fn, ms]
  );
}
