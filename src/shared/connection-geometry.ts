// Pure geometry functions for connected lines - shared between client and server.
// Zero dependencies: operates on plain {x, y, width, height, rotation, type} bounds.

export interface ObjectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  type: string;
}

/** Get the point where a ray from object center toward (targetX, targetY) exits the bounding shape. */
export function getEdgePoint(obj: ObjectBounds, targetX: number, targetY: number): { x: number; y: number } {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;

  let dx = targetX - cx;
  let dy = targetY - cy;

  // Degenerate case: target is at center
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const isCircle = obj.type === "circle";

  if (isCircle) {
    const radius = obj.width / 2;
    const len = Math.sqrt(dx * dx + dy * dy);
    return { x: cx + (dx / len) * radius, y: cy + (dy / len) * radius };
  }

  // Rectangle: parametric ray-AABB intersection
  const rot = (obj.rotation || 0) * (Math.PI / 180);

  // Rotate direction into local (unrotated) space
  if (rot !== 0) {
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const ldx = dx * cos - dy * sin;
    const ldy = dx * sin + dy * cos;
    dx = ldx;
    dy = ldy;
  }

  const hw = obj.width / 2;
  const hh = obj.height / 2;

  // Find smallest positive t where ray (0,0)+t*(dx,dy) hits the AABB edges
  let t = Infinity;
  if (dx !== 0) {
    const tx = (dx > 0 ? hw : -hw) / dx;
    if (tx > 0) t = Math.min(t, tx);
  }
  if (dy !== 0) {
    const ty = (dy > 0 ? hh : -hh) / dy;
    if (ty > 0) t = Math.min(t, ty);
  }
  if (!isFinite(t)) return { x: cx, y: cy };

  let ex = dx * t;
  let ey = dy * t;

  // Rotate back to world space
  if (rot !== 0) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const wx = ex * cos - ey * sin;
    const wy = ex * sin + ey * cos;
    ex = wx;
    ey = wy;
  }

  return { x: cx + ex, y: cy + ey };
}

/** Compute line geometry (x, y, width, height) for a line connecting two objects edge-to-edge. */
export function computeConnectedLineGeometry(
  from: ObjectBounds,
  to: ObjectBounds,
): { x: number; y: number; width: number; height: number } {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  const start = getEdgePoint(from, toCenter.x, toCenter.y);
  const end = getEdgePoint(to, fromCenter.x, fromCenter.y);

  return {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
  };
}

/** Find the nearest object edge point within threshold distance of (x, y). */
export function findSnapTarget(
  x: number,
  y: number,
  objects: Iterable<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    type: string;
  }>,
  threshold = 20,
): { objectId: string; snapPoint: { x: number; y: number } } | null {
  let best: { objectId: string; snapPoint: { x: number; y: number }; dist: number } | null = null;

  for (const obj of objects) {
    // Skip lines - can't snap to a line
    if (obj.type === "line") continue;

    const edge = getEdgePoint(obj, x, y);
    const dx = edge.x - x;
    const dy = edge.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= threshold && (!best || dist < best.dist)) {
      best = { objectId: obj.id, snapPoint: edge, dist };
    }
  }

  return best ? { objectId: best.objectId, snapPoint: best.snapPoint } : null;
}
