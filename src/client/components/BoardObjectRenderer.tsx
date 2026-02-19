import React, { useState, useEffect } from "react";
import { Rect, Text, Group, Ellipse, Line as KonvaLine, Arrow, Image as KonvaImage } from "react-konva";
import type { BoardObject } from "@shared/types";
import { OBJECT_DEFAULTS } from "../constants";

// Renders a base64 image with async loading, error/loading placeholder states
function ImageRenderer({
  src,
  width,
  height,
  aiGlowProps,
}: {
  src: string;
  width: number;
  height: number;
  aiGlowProps: Record<string, unknown>;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!src) {
      setError(true);
      return;
    }
    setError(false);
    setImg(null);
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (!cancelled) setImg(image);
    };
    image.onerror = () => {
      if (!cancelled) setError(true);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (error) {
    return (
      <Rect
        width={width}
        height={height}
        fill="rgba(239,68,68,0.08)"
        stroke="#ef4444"
        strokeWidth={1}
        dash={[4, 4]}
        cornerRadius={4}
      />
    );
  }
  if (!img) {
    return (
      <Rect
        width={width}
        height={height}
        fill="rgba(99,102,241,0.08)"
        stroke="#6366f1"
        strokeWidth={1}
        dash={[4, 4]}
        cornerRadius={4}
      />
    );
  }
  return <KonvaImage image={img} width={width} height={height} cornerRadius={4} {...aiGlowProps} />;
}

export interface BoardObjectRendererProps {
  obj: BoardObject;
  groupProps?: Record<string, unknown>; // drag handlers, ref, etc. (Board-only)
  aiGlow?: boolean; // AI glow effects (Board-only)
  interactive?: boolean; // hitStrokeWidth on lines (Board-only)
}

export const BoardObjectRenderer = React.memo(function BoardObjectRenderer({
  obj,
  groupProps = {},
  aiGlow = false,
  interactive = false,
}: BoardObjectRendererProps) {
  // Merge position from obj with caller's groupProps (interactive overrides like ref, draggable)
  const merged = { x: obj.x, y: obj.y, rotation: obj.rotation, ...groupProps };
  const glowProps = aiGlow ? { shadowBlur: 12, shadowColor: "rgba(99,102,241,0.5)" } : {};
  const lineGlowProps = aiGlow ? { shadowBlur: 8, shadowColor: "rgba(99,102,241,0.4)" } : {};

  if (obj.type === "frame") {
    return (
      <Group {...merged}>
        <Rect
          width={obj.width}
          height={obj.height}
          fill="rgba(99,102,241,0.06)"
          stroke="#6366f1"
          strokeWidth={2}
          dash={[10, 5]}
          cornerRadius={4}
          {...glowProps}
        />
        <Text x={8} y={-20} text={obj.props.text || "Frame"} fontSize={13} fill="#6366f1" fontStyle="600" />
      </Group>
    );
  }
  if (obj.type === "sticky") {
    return (
      <Group {...merged}>
        <Rect
          width={obj.width}
          height={obj.height}
          fill={obj.props.color || OBJECT_DEFAULTS.sticky.color}
          cornerRadius={8}
          shadowBlur={aiGlow ? 12 : 5}
          shadowColor={aiGlow ? "rgba(99,102,241,0.5)" : "rgba(0,0,0,0.3)"}
        />
        <Text x={10} y={10} text={obj.props.text || ""} fontSize={14} fill="#1a1a2e" width={obj.width - 20} />
      </Group>
    );
  }
  if (obj.type === "rect") {
    return (
      <Group {...merged}>
        <Rect
          width={obj.width}
          height={obj.height}
          fill={obj.props.fill || OBJECT_DEFAULTS.rect.fill}
          stroke={obj.props.stroke || OBJECT_DEFAULTS.rect.stroke}
          strokeWidth={2}
          cornerRadius={4}
          {...glowProps}
        />
      </Group>
    );
  }
  if (obj.type === "circle") {
    return (
      <Group {...merged}>
        <Ellipse
          x={obj.width / 2}
          y={obj.height / 2}
          radiusX={obj.width / 2}
          radiusY={obj.height / 2}
          fill={obj.props.fill || OBJECT_DEFAULTS.circle.fill}
          stroke={obj.props.stroke || OBJECT_DEFAULTS.circle.stroke}
          strokeWidth={2}
          {...glowProps}
        />
      </Group>
    );
  }
  if (obj.type === "line") {
    const useArrow = obj.props.arrow === "end" || obj.props.arrow === "both";
    const LineComponent = useArrow ? Arrow : KonvaLine;
    return (
      <Group {...merged}>
        <LineComponent
          points={[0, 0, obj.width, obj.height]}
          stroke={obj.props.stroke || OBJECT_DEFAULTS.line.stroke}
          strokeWidth={3}
          hitStrokeWidth={interactive ? 12 : undefined}
          lineCap="round"
          {...(useArrow
            ? {
                pointerLength: 12,
                pointerWidth: 10,
                ...(obj.props.arrow === "both" ? { pointerAtBeginning: true } : {}),
              }
            : {})}
          {...lineGlowProps}
        />
      </Group>
    );
  }
  if (obj.type === "text") {
    return (
      <Group {...merged}>
        <Text
          text={obj.props.text || ""}
          fontSize={16}
          fill={obj.props.color || OBJECT_DEFAULTS.text.color}
          width={obj.width}
        />
      </Group>
    );
  }
  if (obj.type === "image") {
    return (
      <Group {...merged}>
        <ImageRenderer src={obj.props.src || ""} width={obj.width} height={obj.height} aiGlowProps={glowProps} />
      </Group>
    );
  }
  return null;
});
