import { useEffect, useRef, useState } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import type { WaveEffect as WaveEffectType } from "@shared/types";
import "../styles/animations.css";

const HEART_EMOJI = "❤️";
const HEART_COUNT = 12;
const EFFECT_DURATION_MS = 2500;

interface WaveEffectProps {
  effect: WaveEffectType;
  emoji: string;
  count: number;
  onDone: () => void;
}

/**
 * Canvas-wide visual effects triggered by audience wave events.
 * Each effect auto-dismisses after ~2.5s and calls onDone for cleanup.
 * KEY-DECISION 2026-02-21: Implemented as a separate component (not inline in Board)
 * so SpectatorView can reuse it without duplicating effect logic.
 */
export function WaveEffect({ effect, emoji: _emoji, count: _count, onDone }: WaveEffectProps) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const id = setTimeout(() => doneRef.current(), EFFECT_DURATION_MS);
    return () => clearTimeout(id);
  }, [effect]);

  if (effect === "confetti") {
    // Center-screen confetti burst (reuses existing ConfettiBurst component)
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    return <ConfettiBurst x={x} y={y} onDone={onDone} />;
  }

  if (effect === "hearts") {
    return <HeartsEffect />;
  }

  if (effect === "spotlight") {
    return <div className="cb-wave-spotlight-overlay" />;
  }

  if (effect === "dramatic") {
    return <div className="cb-wave-dramatic-overlay" />;
  }

  // shake and glow are CSS classes applied to the container (see Board.tsx / SpectatorView.tsx)
  // This component returns null for those - the class is applied externally
  return null;
}

function HeartsEffect() {
  const hearts = useRef(
    Array.from({ length: HEART_COUNT }, (_, i) => ({
      id: i,
      left: `${8 + Math.random() * 84}%`,
      delay: `${Math.random() * 0.6}s`,
      rotation: `${(Math.random() - 0.5) * 40}deg`,
    })),
  );

  return (
    <>
      {hearts.current.map((h) => (
        <span
          key={h.id}
          className="cb-wave-heart"
          style={
            {
              left: h.left,
              animationDelay: h.delay,
              "--hw-rot": h.rotation,
            } as React.CSSProperties
          }
        >
          {HEART_EMOJI}
        </span>
      ))}
    </>
  );
}

/** State type for the active wave effect. null = no active wave. */
export interface ActiveWave {
  effect: WaveEffectType;
  emoji: string;
  count: number;
  /** Incremented to re-trigger same effect type */
  key: number;
}

/** Returns CSS classes to add to the stage container div for shake/glow effects. */
export function getWaveContainerClass(wave: ActiveWave | null): string {
  if (!wave) return "";
  if (wave.effect === "shake") return "cb-wave-shake";
  if (wave.effect === "glow") return "cb-wave-glow";
  return "";
}

/** Derive boolean: does this wave effect need the WaveEffect overlay component? */
export function waveNeedsOverlay(effect: WaveEffectType): boolean {
  return effect !== "shake" && effect !== "glow";
}

/** Hook: listen for audienceWave state and manage the active wave */
export function useWaveEffect(
  audienceWave: { emoji: string; count: number; effect: string } | null,
  clearWave: () => void,
): { activeWave: ActiveWave | null; dismissWave: () => void } {
  const [activeWave, setActiveWave] = useState<ActiveWave | null>(null);
  const keyRef = useRef(0);

  useEffect(() => {
    if (!audienceWave) return;
    keyRef.current += 1;
    setActiveWave({
      effect: audienceWave.effect as WaveEffectType,
      emoji: audienceWave.emoji,
      count: audienceWave.count,
      key: keyRef.current,
    });
    clearWave();
  }, [audienceWave, clearWave]);

  const dismissWave = () => setActiveWave(null);

  return { activeWave, dismissWave };
}
