import { useEffect, useRef } from "react";
import { Group, Circle, Text } from "react-konva";
import Konva from "konva";

const AI_CURSOR_COLOR = "#a855f7"; // purple-500 - distinct from sky-400 AI presence dot

// Slower lerp than human cursors (0.25) - feels deliberate, like a performer walking on stage
const LERP_FACTOR = 0.12;

interface AiCursorProps {
  target: { x: number; y: number } | null;
}

/**
 * Purple robot cursor that animates to each AI object creation point.
 * Position is driven imperatively via RAF (no React state) for 60fps smoothness.
 * Visibility is driven by Konva Tween (fade in/out) triggered by target prop changes.
 */
export function AiCursor({ target }: AiCursorProps) {
  const groupRef = useRef<Konva.Group>(null);
  // Ref keeps target accessible inside RAF without triggering re-renders.
  // Updated in useEffect (not during render) to be safe in React concurrent mode.
  const targetRef = useRef(target);
  const isVisibleRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);
  // Single owner for the current in-flight Tween so any cleanup path can destroy it.
  const activeTweenRef = useRef<Konva.Tween | null>(null);

  // Destroy any in-flight Tween and cancel fade timer on unmount
  useEffect(() => {
    return () => {
      activeTweenRef.current?.destroy();
      activeTweenRef.current = null;
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    // Sync after commit - safe in concurrent mode (speculative renders won't update this)
    targetRef.current = target;

    const node = groupRef.current;
    if (!node) return;

    if (target) {
      // Cancel any pending fade-out timer and any in-flight Tween
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      activeTweenRef.current?.destroy();
      activeTweenRef.current = null;

      // First appearance: teleport to position so the lerp starts from the right place
      if (!isVisibleRef.current) {
        node.x(target.x);
        node.y(target.y);
        isVisibleRef.current = true;
      }

      activeTweenRef.current = new Konva.Tween({
        node,
        duration: 0.2,
        opacity: 1,
        easing: Konva.Easings.EaseIn,
      });
      activeTweenRef.current.play();

      return () => {
        activeTweenRef.current?.destroy();
        activeTweenRef.current = null;
        // Snap to final value so StrictMode double-invocation doesn't leave partial opacity
        groupRef.current?.opacity(1);
      };
    } else {
      // Delay fade-out so cursor lingers at the last creation point
      fadeTimerRef.current = setTimeout(() => {
        // Use ref, not closed-over `node` - component may have unmounted during delay
        const currentNode = groupRef.current;
        if (!currentNode) return;

        activeTweenRef.current?.destroy();
        activeTweenRef.current = new Konva.Tween({
          node: currentNode,
          duration: 0.4,
          opacity: 0,
          easing: Konva.Easings.EaseOut,
          onFinish: () => {
            activeTweenRef.current?.destroy();
            activeTweenRef.current = null;
            isVisibleRef.current = false;
          },
        });
        activeTweenRef.current.play();
      }, 500);

      return () => {
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        activeTweenRef.current?.destroy();
        activeTweenRef.current = null;
      };
    }
  }, [target]);

  // RAF lerp loop - runs for component lifetime (same pattern as Cursors.tsx).
  // batchDraw only fires when actually moving, so idle cost is minimal (just the condition check).
  useEffect(() => {
    const tick = () => {
      const node = groupRef.current;
      const tgt = targetRef.current;
      if (node && tgt && isVisibleRef.current) {
        const dx = tgt.x - node.x();
        const dy = tgt.y - node.y();
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          node.x(node.x() + dx * LERP_FACTOR);
          node.y(node.y() + dy * LERP_FACTOR);
          const layer = node.getLayer();
          if (layer) {
            layer.batchDraw();
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <Group ref={groupRef} opacity={0} listening={false}>
      <Circle
        radius={7}
        fill={AI_CURSOR_COLOR}
        shadowColor={AI_CURSOR_COLOR}
        shadowBlur={14}
        shadowOpacity={0.8}
      />
      <Text
        text="AI"
        fontSize={9}
        fontStyle="bold"
        fill="#fff"
        x={-8}
        y={11}
        width={16}
        align="center"
        listening={false}
      />
    </Group>
  );
}
