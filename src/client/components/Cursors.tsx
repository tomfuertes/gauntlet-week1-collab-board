import { useRef, useEffect } from "react";
import { Circle, Group, Line, Text } from "react-konva";
import type Konva from "konva";
import { colors, getUserColor } from "../theme";
import { AI_USER_ID } from "@shared/types";

// Each frame the cursor moves 25% of the remaining distance.
// At 60fps with 30fps cursor updates, a 100px jump reaches 95% in ~200ms.
const LERP_FACTOR = 0.25;
const TRAIL_LENGTH = 12;
const TRAIL_SAMPLE_INTERVAL = 3; // sample every N rAF frames

interface CursorState {
  userId: string;
  username: string;
  x: number;
  y: number;
}

interface LerpPos {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export function Cursors({ cursors }: { cursors: Map<string, CursorState> }) {
  const groupRefs = useRef<Map<string, Konva.Group>>(new Map());
  const trailRefs = useRef<Map<string, Konva.Line>>(new Map());
  const aiDotRef = useRef<Konva.Circle | null>(null);
  const positions = useRef<Map<string, LerpPos>>(new Map());
  const trails = useRef<Map<string, number[]>>(new Map());

  // Update targets on every render (no deps needed - runs synchronously before paint)
  for (const [userId, cursor] of cursors) {
    const pos = positions.current.get(userId);
    if (pos) {
      pos.tx = cursor.x;
      pos.ty = cursor.y;
    } else {
      positions.current.set(userId, { x: cursor.x, y: cursor.y, tx: cursor.x, ty: cursor.y });
    }
  }
  // Clean stale cursors
  for (const userId of positions.current.keys()) {
    if (!cursors.has(userId)) {
      positions.current.delete(userId);
      groupRefs.current.delete(userId);
      trailRefs.current.delete(userId);
      trails.current.delete(userId);
    }
  }

  // Single rAF loop for lerp + trail sampling (runs for component lifetime)
  useEffect(() => {
    let animId: number;
    let frameCount = 0;
    const animate = () => {
      frameCount++;
      for (const [userId, pos] of positions.current) {
        const dx = pos.tx - pos.x;
        const dy = pos.ty - pos.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          pos.x += dx * LERP_FACTOR;
          pos.y += dy * LERP_FACTOR;
        } else {
          pos.x = pos.tx;
          pos.y = pos.ty;
        }
        const group = groupRefs.current.get(userId);
        if (group) {
          group.x(pos.x);
          group.y(pos.y);
        }

        // AI cursor: animate pulse radius instead of trails
        if (userId === AI_USER_ID) {
          const dot = aiDotRef.current;
          if (dot) {
            dot.radius(6 + Math.sin(frameCount * 0.08) * 1.5);
          }
          continue;
        }

        // Sample trail position periodically
        if (frameCount % TRAIL_SAMPLE_INTERVAL === 0) {
          let trail = trails.current.get(userId);
          if (!trail) {
            trail = [];
            trails.current.set(userId, trail);
          }
          trail.push(pos.x, pos.y);
          if (trail.length > TRAIL_LENGTH * 2) {
            trail.splice(0, 2); // remove oldest point (x,y pair)
          }
          // Update trail line imperatively
          const trailLine = trailRefs.current.get(userId);
          if (trailLine && trail.length >= 4) {
            trailLine.points(trail);
          }
        }
      }
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <>
      {/* Trail lines (rendered behind cursor shapes) - skip AI cursor */}
      {[...cursors.values()].filter(c => c.userId !== AI_USER_ID).map((cursor) => {
        const color = getUserColor(cursor.userId);
        return (
          <Line
            key={`trail-${cursor.userId}`}
            ref={(node: Konva.Line | null) => {
              if (node) trailRefs.current.set(cursor.userId, node);
              else trailRefs.current.delete(cursor.userId);
            }}
            points={[]}
            stroke={color}
            strokeWidth={2}
            opacity={0.3}
            lineCap="round"
            lineJoin="round"
            tension={0.4}
            listening={false}
          />
        );
      })}
      {/* Cursor shapes */}
      {[...cursors.values()].map((cursor) => {
        const isAi = cursor.userId === AI_USER_ID;
        const color = isAi ? colors.aiCursor : getUserColor(cursor.userId);
        return (
          <Group
            key={cursor.userId}
            ref={(node: Konva.Group | null) => {
              if (node) {
                groupRefs.current.set(cursor.userId, node);
                // Set initial position immediately to avoid 0,0 flash
                const pos = positions.current.get(cursor.userId);
                if (pos) { node.x(pos.x); node.y(pos.y); }
              } else {
                groupRefs.current.delete(cursor.userId);
              }
            }}
          >
            {isAi ? (
              /* AI cursor: pulsing filled dot */
              <Circle
                ref={(node: Konva.Circle | null) => { aiDotRef.current = node; }}
                radius={6}
                fill={colors.aiCursor}
                opacity={0.85}
              />
            ) : (
              /* Arrow cursor shape */
              <Line
                points={[0, 0, 0, 16, 4, 12, 8, 20, 11, 19, 7, 11, 12, 11]}
                fill={color}
                closed
                stroke={color}
                strokeWidth={0.5}
              />
            )}
            {/* Name label */}
            <Text
              x={isAi ? 10 : 14}
              y={10}
              text={cursor.username}
              fontSize={11}
              fill="#fff"
              padding={2}
            />
          </Group>
        );
      })}
    </>
  );
}
