import React from "react";
import { Layer, Ellipse, Text as KonvaText } from "react-konva";

// KEY-DECISION 2026-02-20: GAP=36 is center-to-center stride, not whitespace between figures.
// 28 figures × 36px stride ≈ 1000px total - fits within the 1100px canvas width with margin.
const FIGURE_W = 28;
const GAP = 36;
const MAX_VISIBLE = 28;
const FIGURE_FILL = "rgba(8,12,28,0.88)";
// KEY-DECISION 2026-02-21: Ghost fill is lighter (dark navy vs near-black) and drawn at 0.2 opacity
// so 3 default silhouettes always convey "audience" without competing with stage content.
const GHOST_FILL = "rgba(30,40,70,0.6)";
const DEFAULT_AUDIENCE = 3; // always show this many ghost seats

export const AUDIENCE_Y = 740; // world-space y of audience head centers
const CANVAS_LEFT = 50;
const CANVAS_WIDTH = 1100;

/** World-space X center of each visible audience figure. */
export function getAudienceFigureXs(count: number): number[] {
  const visible = Math.min(count, MAX_VISIBLE);
  if (visible === 0) return [];
  const totalWidth = (visible - 1) * GAP + FIGURE_W;
  const startX = CANVAS_LEFT + (CANVAS_WIDTH - totalWidth) / 2 + FIGURE_W / 2;
  return Array.from({ length: visible }, (_, i) => startX + i * GAP);
}

interface AudienceRowProps {
  spectatorCount: number;
  spectators?: { id: string; username: string }[];
}

export function AudienceRow({ spectatorCount, spectators = [] }: AudienceRowProps) {
  // Always show at least 3 default ghost seats so the stage always has an "audience".
  const displayCount = Math.max(DEFAULT_AUDIENCE, spectatorCount);
  const xs = getAudienceFigureXs(displayCount);
  const overflow = spectatorCount - Math.min(spectatorCount, MAX_VISIBLE);

  return (
    <Layer listening={false}>
      {xs.map((cx, i) => {
        const isReal = i < spectatorCount;
        const spectator = isReal ? spectators[i] : undefined;
        // Show a name label for authenticated spectators (not anonymous "Spectator" fallback)
        const nameLabel = spectator && spectator.username !== "Spectator" ? spectator.username.slice(0, 8) : undefined;
        const fill = isReal ? FIGURE_FILL : GHOST_FILL;
        const opacity = isReal ? 0.75 : 0.2;
        return (
          <React.Fragment key={i}>
            {/* Name label above head for authenticated spectators */}
            {nameLabel && (
              <KonvaText
                x={cx - GAP / 2}
                y={AUDIENCE_Y - 30}
                width={GAP}
                text={nameLabel}
                fill="rgba(255,255,255,0.55)"
                fontSize={8}
                align="center"
              />
            )}
            {/* Head silhouette */}
            <Ellipse
              x={cx}
              y={AUDIENCE_Y}
              radiusX={FIGURE_W / 2}
              radiusY={FIGURE_W / 2 + 2}
              fill={fill}
              opacity={opacity}
            />
            {/* Shoulders silhouette */}
            <Ellipse x={cx} y={AUDIENCE_Y + 20} radiusX={FIGURE_W / 2 + 8} radiusY={10} fill={fill} opacity={opacity} />
          </React.Fragment>
        );
      })}
      {overflow > 0 && (
        <KonvaText
          x={xs[xs.length - 1] + GAP}
          y={AUDIENCE_Y - 12}
          text={`+${overflow}`}
          fill="rgba(255,255,255,0.5)"
          fontSize={12}
        />
      )}
    </Layer>
  );
}
