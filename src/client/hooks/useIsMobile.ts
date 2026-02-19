import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = "(max-width: 768px)";

// matchMedia is unavailable in non-browser environments (CF Workers, jsdom without polyfills).
// Guard defensively so this hook is safe to use anywhere without crashing.
function getInitialIsMobile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_BREAKPOINT).matches;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(getInitialIsMobile);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
