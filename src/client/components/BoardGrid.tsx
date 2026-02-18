import { Rect, Shape } from "react-konva";

/** Render the dot grid + radial glow background for the canvas */
export function BoardGrid({
  stagePos,
  scale,
  size,
}: {
  stagePos: { x: number; y: number };
  scale: number;
  size: { width: number; height: number };
}) {
  const gridSize = 50;

  // Subtle radial glow for canvas depth
  const viewCenterX = (-stagePos.x + size.width / 2) / scale;
  const viewCenterY = (-stagePos.y + size.height / 2) / scale;
  const glowRadius =
    (Math.max(size.width, size.height) / scale) * 0.7;

  // Grid dot bounds
  const startX =
    Math.floor(-stagePos.x / scale / gridSize) * gridSize - gridSize;
  const startY =
    Math.floor(-stagePos.y / scale / gridSize) * gridSize - gridSize;
  const endX = startX + size.width / scale + gridSize * 2;
  const endY = startY + size.height / scale + gridSize * 2;

  return (
    <>
      <Rect
        key="glow"
        x={viewCenterX - glowRadius}
        y={viewCenterY - glowRadius}
        width={glowRadius * 2}
        height={glowRadius * 2}
        fillRadialGradientStartPoint={{ x: glowRadius, y: glowRadius }}
        fillRadialGradientEndPoint={{ x: glowRadius, y: glowRadius }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndRadius={glowRadius}
        fillRadialGradientColorStops={[
          0,
          "rgba(99,102,241,0.06)",
          0.5,
          "rgba(99,102,241,0.02)",
          1,
          "transparent",
        ]}
        listening={false}
      />
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          let count = 0;
          for (let x = startX; x < endX; x += gridSize) {
            for (let y = startY; y < endY; y += gridSize) {
              if (count++ >= 2000) break;
              ctx.rect(x - 1, y - 1, 2, 2);
            }
            if (count >= 2000) break;
          }
          ctx.fillStrokeShape(shape);
        }}
        fill="rgba(255,255,255,0.1)"
        listening={false}
      />
    </>
  );
}
