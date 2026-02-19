import { Stage, Layer } from "react-konva";
import type { BoardObject } from "@shared/types";
import { BoardObjectRenderer } from "./BoardObjectRenderer";
import { colors } from "../theme";

interface CanvasPreviewProps {
  objects: Map<string, BoardObject>;
  width: number;
  height: number;
}

/** Compute scale + offset to fit all objects into the preview area with padding. */
function computeTransform(
  objects: Map<string, BoardObject>,
  width: number,
  height: number
): { scale: number; x: number; y: number } {
  if (objects.size === 0) return { scale: 1, x: 0, y: 0 };
  // Guard: negative/zero width or height (layout race before resize fires, or test env).
  // A negative scale passed to Konva renders mirrored content with no error thrown.
  if (width <= 0 || height <= 0) return { scale: 1, x: 0, y: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of objects.values()) {
    // Skip objects with NaN coordinates (partial WS delivery during reconnect).
    // NaN propagates silently through all math and produces a blank Konva Stage.
    if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) continue;
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + Math.abs(obj.width || 100));
    maxY = Math.max(maxY, obj.y + Math.abs(obj.height || 100));
  }
  // All objects had invalid coordinates
  if (!Number.isFinite(minX)) return { scale: 1, x: 0, y: 0 };

  const PAD = 24;
  const contentW = Math.max(maxX - minX + PAD * 2, 100);
  const contentH = Math.max(maxY - minY + PAD * 2, 100);
  // Clamp available area to avoid negative division (small containers during layout)
  const availW = Math.max(width - PAD * 2, 1);
  const availH = Math.max(height - PAD * 2, 1);
  // Cap at 1x to avoid upscaling sparse boards
  const scale = Math.min(availW / contentW, availH / contentH, 1);
  // Center the scaled content in the preview area
  const x = -(minX - PAD) * scale + (width - contentW * scale) / 2;
  const y = -(minY - PAD) * scale + (height - contentH * scale) / 2;

  return { scale, x, y };
}

/**
 * Read-only scaled-down Konva Stage showing the current board state.
 * listening={false} on Stage disables all pointer events - no drag, no select, no tools.
 */
export function CanvasPreview({ objects, width, height }: CanvasPreviewProps) {
  const { scale, x, y } = computeTransform(objects, width, height);

  if (objects.size === 0) {
    return (
      <div style={{
        width, height, background: colors.bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: colors.textDim, fontSize: "0.75rem",
      }}>
        Canvas is empty - ask the AI to create something!
      </div>
    );
  }

  return (
    <Stage
      width={width}
      height={height}
      x={x}
      y={y}
      scaleX={scale}
      scaleY={scale}
      listening={false}
    >
      {/* Frames behind, then objects on top - same render order as interactive Board */}
      <Layer listening={false}>
        {[...objects.values()].filter(o => o.type === "frame").map((obj) => (
          <BoardObjectRenderer key={obj.id} obj={obj} aiGlow={false} interactive={false} />
        ))}
        {[...objects.values()].filter(o => o.type !== "frame").map((obj) => (
          <BoardObjectRenderer key={obj.id} obj={obj} aiGlow={false} interactive={false} />
        ))}
      </Layer>
    </Stage>
  );
}
