import { useState, useEffect, useRef, useCallback } from "react";
import { Stage, Layer, Rect, Text, Group, Ellipse, Line as KonvaLine, Arrow, Image as KonvaImage } from "react-konva";
import type { BoardObject, ReplayEvent } from "@shared/types";
import { colors } from "../theme";

// Component for rendering base64 images (needs hooks for async loading)
function ReplayImageObj({ obj }: { obj: BoardObject }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!obj.props.src) { setError(true); return; }
    setError(false);
    setImg(null);
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => { if (!cancelled) setImg(image); };
    image.onerror = () => { if (!cancelled) setError(true); };
    image.src = obj.props.src;
    return () => { cancelled = true; };
  }, [obj.props.src]);
  const base = { x: obj.x, y: obj.y, rotation: obj.rotation };
  return (
    <Group {...base}>
      {error ? (
        <Rect width={obj.width} height={obj.height} fill="rgba(239,68,68,0.08)" stroke="#ef4444" strokeWidth={1} dash={[4, 4]} cornerRadius={4} />
      ) : img ? (
        <KonvaImage image={img} width={obj.width} height={obj.height} cornerRadius={4} />
      ) : (
        <Rect width={obj.width} height={obj.height} fill="rgba(99,102,241,0.08)" stroke="#6366f1" strokeWidth={1} dash={[4, 4]} cornerRadius={4} />
      )}
    </Group>
  );
}

interface ReplayViewerProps {
  boardId: string;
  onBack: () => void;
}

function renderObject(obj: BoardObject) {
  const base = { x: obj.x, y: obj.y, rotation: obj.rotation };

  if (obj.type === "frame") {
    return (
      <Group key={obj.id} {...base}>
        <Rect width={obj.width} height={obj.height} fill="rgba(99,102,241,0.06)" stroke="#6366f1" strokeWidth={2} dash={[10, 5]} cornerRadius={4} />
        <Text x={8} y={-20} text={obj.props.text || "Frame"} fontSize={13} fill="#6366f1" fontStyle="600" />
      </Group>
    );
  }
  if (obj.type === "sticky") {
    return (
      <Group key={obj.id} {...base}>
        <Rect width={obj.width} height={obj.height} fill={obj.props.color || "#fbbf24"} cornerRadius={8} shadowBlur={5} shadowColor="rgba(0,0,0,0.3)" />
        <Text x={10} y={10} text={obj.props.text || ""} fontSize={14} fill="#1a1a2e" width={obj.width - 20} />
      </Group>
    );
  }
  if (obj.type === "rect") {
    return (
      <Group key={obj.id} {...base}>
        <Rect width={obj.width} height={obj.height} fill={obj.props.fill || "#3b82f6"} stroke={obj.props.stroke || "#2563eb"} strokeWidth={2} cornerRadius={4} />
      </Group>
    );
  }
  if (obj.type === "circle") {
    return (
      <Group key={obj.id} {...base}>
        <Ellipse x={obj.width / 2} y={obj.height / 2} radiusX={obj.width / 2} radiusY={obj.height / 2} fill={obj.props.fill || "#8b5cf6"} stroke={obj.props.stroke || "#7c3aed"} strokeWidth={2} />
      </Group>
    );
  }
  if (obj.type === "line") {
    const useArrow = obj.props.arrow === "end" || obj.props.arrow === "both";
    const LineComponent = useArrow ? Arrow : KonvaLine;
    return (
      <Group key={obj.id} {...base}>
        <LineComponent
          points={[0, 0, obj.width, obj.height]}
          stroke={obj.props.stroke || "#f43f5e"}
          strokeWidth={3}
          lineCap="round"
          {...(useArrow ? {
            pointerLength: 12,
            pointerWidth: 10,
            ...(obj.props.arrow === "both" ? { pointerAtBeginning: true } : {}),
          } : {})}
        />
      </Group>
    );
  }
  if (obj.type === "text") {
    return (
      <Group key={obj.id} {...base}>
        <Text text={obj.props.text || ""} fontSize={16} fill={obj.props.color || "#ffffff"} width={obj.width} />
      </Group>
    );
  }
  if (obj.type === "image") {
    return <ReplayImageObj key={obj.id} obj={obj} />;
  }
  return null;
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
        targets.set(evt.obj.id, { ...existing, ...evt.obj, props: { ...existing.props, ...(evt.obj.props || {}) } });
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
        <button onClick={onBack} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted, padding: "0.5rem 1rem", cursor: "pointer" }}>
          Back
        </button>
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
          <button onClick={onBack} style={{
            background: "none", border: "none", color: colors.textMuted, cursor: "pointer",
            fontSize: "0.875rem", padding: 0,
          }}>&larr; Back</button>
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
            {objects.map((obj) => renderObject(obj))}
          </Layer>
        </Stage>
      </div>

      {/* Controls bar */}
      <div style={{
        height: controlsH, display: "flex", alignItems: "center", gap: "1rem",
        padding: "0 1rem", background: colors.overlayHeader, borderTop: `1px solid ${colors.border}`,
      }}>
        <button
          onClick={handlePlayPause}
          disabled={events.length === 0}
          style={{
            background: colors.accent, border: "none", borderRadius: 4, color: "#fff",
            padding: "0.25rem 1rem", cursor: events.length > 0 ? "pointer" : "default",
            fontSize: "0.875rem", fontWeight: 600, opacity: events.length === 0 ? 0.5 : 1,
          }}
        >
          {playing ? "Pause" : currentIndex >= events.length - 1 && currentIndex >= 0 ? "Replay" : "Play"}
        </button>

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
