import React from "react";
import { Layer, Ellipse, Text as KonvaText } from "react-konva";

// KEY-DECISION 2026-02-20: GAP=36 is center-to-center stride, not whitespace between figures.
// 28 figures × 36px stride ≈ 1000px total - fits within the 1100px canvas width with margin.
const FIGURE_W = 28;
const GAP = 36;
const MAX_VISIBLE = 28;
const FIGURE_FILL = "rgba(8,12,28,0.88)";

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
}

export function AudienceRow({ spectatorCount }: AudienceRowProps) {
  if (spectatorCount === 0) return null;

  const xs = getAudienceFigureXs(spectatorCount);
  const overflow = spectatorCount - xs.length;

  return (
    <Layer listening={false} opacity={0.75}>
      {xs.map((cx, i) => (
        <React.Fragment key={i}>
          {/* Head silhouette */}
          <Ellipse x={cx} y={AUDIENCE_Y} radiusX={FIGURE_W / 2} radiusY={FIGURE_W / 2 + 2} fill={FIGURE_FILL} />
          {/* Shoulders silhouette */}
          <Ellipse x={cx} y={AUDIENCE_Y + 20} radiusX={FIGURE_W / 2 + 8} radiusY={10} fill={FIGURE_FILL} />
        </React.Fragment>
      ))}
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
