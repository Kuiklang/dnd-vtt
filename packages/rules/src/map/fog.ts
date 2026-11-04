/**
 * Manual fog of war. A scene with fog enabled starts fully hidden; DMs append
 * reveal/hide shapes in order and the last shape covering a point wins.
 * The same model drives server-side filtering (what tokens a player receives)
 * and client-side drawing, so they can never disagree.
 *
 * Architecture note: dynamic vision (Phase 8) will add a second visibility source
 * (line of sight from owned tokens) that is OR-ed with this manual layer.
 */
import type { Point } from "./geometry.js";

export const FOG_SHAPES = ["rect", "circle", "polygon"] as const;
export type FogShapeKind = (typeof FOG_SHAPES)[number];

export type FogShape =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "polygon"; points: Point[] };

export interface FogOp {
  id: string;
  mode: "reveal" | "hide";
  shape: FogShape;
}

export interface FogState {
  enabled: boolean;
  ops: FogOp[];
}

export const MAX_FOG_OPS = 2000;
export const MAX_POLYGON_POINTS = 200;

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function shapeContains(shape: FogShape, p: Point): boolean {
  switch (shape.kind) {
    case "rect": {
      const x0 = Math.min(shape.x, shape.x + shape.width);
      const y0 = Math.min(shape.y, shape.y + shape.height);
      return p.x >= x0 && p.x <= x0 + Math.abs(shape.width) && p.y >= y0 && p.y <= y0 + Math.abs(shape.height);
    }
    case "circle":
      return Math.hypot(p.x - shape.x, p.y - shape.y) <= shape.radius;
    case "polygon":
      return shape.points.length >= 3 && pointInPolygon(p, shape.points);
  }
}

/** Whether a point is visible (not covered by fog) for players. */
export function isPointRevealed(fog: FogState, p: Point): boolean {
  if (!fog.enabled) return true;
  for (let i = fog.ops.length - 1; i >= 0; i--) {
    const op = fog.ops[i]!;
    if (shapeContains(op.shape, p)) return op.mode === "reveal";
  }
  return false;
}

/** Normalises a shape from untrusted input (positive sizes, finite numbers). */
export function normalizeShape(shape: FogShape): FogShape | null {
  const finite = (...n: number[]) => n.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6);
  switch (shape.kind) {
    case "rect": {
      if (!finite(shape.x, shape.y, shape.width, shape.height)) return null;
      const x = Math.min(shape.x, shape.x + shape.width);
      const y = Math.min(shape.y, shape.y + shape.height);
      const width = Math.abs(shape.width);
      const height = Math.abs(shape.height);
      return width < 1 || height < 1 ? null : { kind: "rect", x, y, width, height };
    }
    case "circle":
      if (!finite(shape.x, shape.y, shape.radius) || shape.radius < 1) return null;
      return { kind: "circle", x: shape.x, y: shape.y, radius: shape.radius };
    case "polygon": {
      const pts = shape.points.filter((p) => finite(p.x, p.y)).slice(0, MAX_POLYGON_POINTS);
      return pts.length >= 3 ? { kind: "polygon", points: pts.map((p) => ({ x: p.x, y: p.y })) } : null;
    }
  }
}
