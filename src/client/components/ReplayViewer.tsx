import { useState, useEffect, useRef, useCallback } from "react";
import { Stage, Layer, Rect } from "react-konva";
import type { BoardObject, ReplayEvent } from "@shared/types";
import { colors } from "../theme";
import { BoardObjectRenderer } from "./BoardObjectRenderer";
import { Button } from "./Button";

interface ReplayViewerProps {
  boardId: string;
  onBack: () => void;
}

export function ReplayViewer({ boardId, onBack }: ReplayViewerProps) {
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const objectsRef = useRef(new Map<string, BoardObject>());
  const renderMapRef = useRef(new Map<string, BoardObject>());
  const [objects, setObjects] = useState<BoardObject[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef(0);

  // Fetch events on mount
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/boards/${boardId}/replay`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ReplayEvent[]>;
      })
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => ac.abort();
  }, [boardId]);

  // Window resize
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const applyEvent = useCallback((evt: ReplayEvent) => {
    const targets = objectsRef.current;
    const rendered = renderMapRef.current;

    if (evt.type === "obj:create" && evt.obj) {
      targets.set(evt.obj.id, evt.obj);
      rendered.set(evt.obj.id, { ...evt.obj }); // instant appear
    } else if (evt.type === "obj:update" && evt.obj) {
      const existing = targets.get(evt.obj.id);
      if (existing) {
        targets.set(evt.obj.id, { ...existing, ...evt.obj, props: { ...existing.props, ...(evt.obj.props || {}) } } as BoardObject);
      } else {
        targets.set(evt.obj.id, evt.obj);
        rendered.set(evt.obj.id, { ...evt.obj }); // new object, instant
      }
      // Apply non-spatial props instantly to rendered copy
      const r = rendered.get(evt.obj.id);
      if (r && evt.obj.props) {
        r.props = { ...r.props, ...evt.obj.props };
      }
    } else if (evt.type === "obj:delete" && evt.id) {
      targets.delete(evt.id);
      rendered.delete(evt.id); // instant removal
    }

    setObjects([...rendered.values()]);
  }, []);

  // RAF interpolation loop - lerps rendered positions toward targets
  useEffect(() => {
    if (!playing) return;

    const LERP = 0.25;
    const SNAP = 0.5;
    const targets = objectsRef.current;
    const rendered = renderMapRef.current;

    function tick() {
      let changed = false;

      for (const [id, target] of targets) {
        const r = rendered.get(id);
        if (!r) {
          rendered.set(id, { ...target });
          changed = true;
          continue;
        }

        for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
          const diff = target[key] - r[key];
          if (Math.abs(diff) > SNAP) {
            r[key] += diff * LERP;
            changed = true;
          } else if (diff !== 0) {
            r[key] = target[key];
            changed = true;
          }
        }
      }

      if (changed) {
        setObjects([...rendered.values()]);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      // Snap to final positions on pause/stop
      let snapped = false;
      for (const [id, target] of targets) {
        const r = rendered.get(id);
        if (!r || r.x !== target.x || r.y !== target.y || r.width !== target.width || r.height !== target.height || r.rotation !== target.rotation) {
          rendered.set(id, { ...target });
          snapped = true;
        }
      }
      if (snapped) setObjects([...rendered.values()]);
    };
  }, [playing]);

  // Playback engine
  useEffect(() => {
    if (!playing || events.length === 0) return;

    const next = currentIndex + 1;
    if (next >= events.length) {
      setPlaying(false);
      return;
    }

    const delay = currentIndex < 0
      ? 0
      : Math.min(events[next].ts - events[currentIndex].ts, 2000);

    timerRef.current = setTimeout(() => {
      applyEvent(events[next]);
      setCurrentIndex(next);
    }, delay);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, currentIndex, events, applyEvent]);

  const handlePlayPause = () => {
    if (playing) {
      setPlaying(false);
    } else if (currentIndex >= events.length - 1) {
      // Restart from beginning
      objectsRef.current.clear();
      renderMapRef.current.clear();
      setObjects([]);
      setCurrentIndex(-1);
      setPlaying(true);
    } else {
      setPlaying(true);
    }
  };

  const headerH = 48;
  const controlsH = 48;
  const stageH = size.height - headerH - controlsH;
  const progress = events.length > 0 ? Math.max(0, currentIndex + 1) / events.length : 0;

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: colors.bg, color: colors.text }}>
        Loading replay...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: colors.bg, color: colors.text, gap: "1rem" }}>
        <span style={{ color: colors.error }}>Failed to load replay: {error}</span>
        <Button onClick={onBack} style={{ padding: "0.5rem 1rem" }}>Back</Button>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", background: colors.bg, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        height: headerH, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", color: colors.text, fontSize: "0.875rem",
        background: colors.overlayHeader, borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Button variant="link" onClick={onBack} style={{ color: colors.textMuted, fontSize: "0.875rem" }}>&larr; Back</Button>
          <span style={{ fontWeight: 600 }}>Scene Replay</span>
        </div>
        <span style={{ color: colors.textDim }}>
          {events.length === 0 ? "No events recorded" : `${events.length} events`}
        </span>
      </div>

      {/* Konva stage */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <Stage width={size.width} height={stageH}>
          <Layer>
            {/* Background */}
            <Rect x={0} y={0} width={size.width} height={stageH} fill={colors.bg} listening={false} />
            {objects.map((obj) => <BoardObjectRenderer key={obj.id} obj={obj} />)}
          </Layer>
        </Stage>
      </div>

      {/* Controls bar */}
      <div style={{
        height: controlsH, display: "flex", alignItems: "center", gap: "1rem",
        padding: "0 1rem", background: colors.overlayHeader, borderTop: `1px solid ${colors.border}`,
      }}>
        <Button
          variant="primary"
          onClick={handlePlayPause}
          disabled={events.length === 0}
          style={{ padding: "0.25rem 1rem", fontSize: "0.875rem", fontWeight: 600 }}
        >
          {playing ? "Pause" : currentIndex >= events.length - 1 && currentIndex >= 0 ? "Replay" : "Play"}
        </Button>

        {/* Progress bar */}
        <div style={{ flex: 1, height: 4, background: colors.border, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: colors.accent, transition: "width 0.1s" }} />
        </div>

        <span style={{ color: colors.textDim, fontSize: "0.75rem", minWidth: 60, textAlign: "right" }}>
          {Math.max(0, currentIndex + 1)} / {events.length}
        </span>
      </div>
    </div>
  );
}
