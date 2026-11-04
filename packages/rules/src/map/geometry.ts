/**
 * Map geometry shared by server and client: grids, snapping, distance and the
 * manual fog-of-war model. Pure functions only, so the server can decide what a
 * player may see with exactly the same math the client uses to draw it.
 */
import type { DiagonalRule } from "../rulesets/types.js";

export interface Point {
  x: number;
  y: number;
}

export const GRID_TYPES = ["square", "hex", "none"] as const;
export type GridType = (typeof GRID_TYPES)[number];

export interface GridSettings {
  type: GridType;
  /** Square: cell edge in px. Hex (pointy-top): distance between adjacent hex centres in px. */
  size: number;
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
  /** Distance represented by one cell, e.g. 5. */
  unitsPerCell: number;
  /** Unit label, e.g. "ft". */
  unit: string;
}

export const DEFAULT_GRID: GridSettings = {
  type: "square",
  size: 70,
  offsetX: 0,
  offsetY: 0,
  color: "#000000",
  opacity: 0.35,
  unitsPerCell: 5,
  unit: "ft",
};

// ---- Hex helpers (pointy-top, axial coordinates) ------------------------

/** Hex "radius" (centre to corner) for a centre-to-centre spacing `size`. */
export const hexRadius = (size: number) => size / Math.sqrt(3);

interface Axial {
  q: number;
  r: number;
}

function hexToPixel(h: Axial, g: GridSettings): Point {
  const r = hexRadius(g.size);
  return {
    x: g.offsetX + g.size * (h.q + h.r / 2),
    y: g.offsetY + r * 1.5 * h.r,
  };
}

function pixelToHexFloat(p: Point, g: GridSettings): Axial {
  const r = hexRadius(g.size);
  const x = p.x - g.offsetX;
  const y = p.y - g.offsetY;
  const rr = y / (1.5 * r);
  const q = x / g.size - rr / 2;
  return { q, r: rr };
}

function hexRound(h: Axial): Axial {
  const s = -h.q - h.r;
  let q = Math.round(h.q);
  let r = Math.round(h.r);
  const rs = Math.round(s);
  const dq = Math.abs(q - h.q);
  const dr = Math.abs(r - h.r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) q = -r - rs;
  else if (dr > ds) r = -q - rs;
  return { q: q + 0, r: r + 0 };
}

const hexDistanceCells = (a: Axial, b: Axial) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/** Corner points of the hex containing `p` (for drawing / highlighting). */
export function hexCorners(center: Point, size: number): Point[] {
  const r = hexRadius(size);
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
  });
}

// ---- Snapping -----------------------------------------------------------

/**
 * Snaps the centre of a token occupying `cells` × `cells` squares to the grid.
 * Odd sizes snap to cell centres, even sizes to grid intersections.
 */
export function snapToGrid(p: Point, g: GridSettings, cells = 1): Point {
  if (g.type === "none" || g.size <= 0) return { x: p.x, y: p.y };
  if (g.type === "hex") return hexToPixel(hexRound(pixelToHexFloat(p, g)), g);
  const half = cells % 2 === 1 ? g.size / 2 : 0;
  const snap = (v: number, off: number) => Math.round((v - off - half) / g.size) * g.size + off + half;
  return { x: snap(p.x, g.offsetX), y: snap(p.y, g.offsetY) };
}

/** Grid cell index containing a point (square grids), useful for coordinate display. */
export function cellAt(p: Point, g: GridSettings): { col: number; row: number } | null {
  if (g.type === "none" || g.size <= 0) return null;
  if (g.type === "hex") {
    const h = hexRound(pixelToHexFloat(p, g));
    // Offset ("odd-r") coordinates read naturally as col/row.
    return { col: h.q + (h.r - (h.r & 1)) / 2, row: h.r };
  }
  return { col: Math.floor((p.x - g.offsetX) / g.size), row: Math.floor((p.y - g.offsetY) / g.size) };
}

// ---- Distance -----------------------------------------------------------

/** Distance in cells between two points under the ruleset's diagonal rule. */
export function cellDistance(a: Point, b: Point, g: GridSettings, diagonal: DiagonalRule): number {
  if (g.size <= 0) return 0;
  if (g.type === "hex") return hexDistanceCells(hexRound(pixelToHexFloat(a, g)), hexRound(pixelToHexFloat(b, g)));
  if (g.type === "none" || diagonal === "euclidean") return Math.hypot(b.x - a.x, b.y - a.y) / g.size;
  const ca = cellAt(a, g)!;
  const cb = cellAt(b, g)!;
  const dx = Math.abs(ca.col - cb.col);
  const dy = Math.abs(ca.row - cb.row);
  const diag = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diag;
  if (diagonal === "uniform") return diag + straight;
  // Alternating 1-2-1: every second diagonal costs double.
  return straight + diag + Math.floor(diag / 2);
}

/** Total distance along a path of waypoints, in game units (e.g. feet). */
export function pathDistance(points: Point[], g: GridSettings, diagonal: DiagonalRule): number {
  let cells = 0;
  for (let i = 1; i < points.length; i++) cells += cellDistance(points[i - 1]!, points[i]!, g, diagonal);
  const units = cells * g.unitsPerCell;
  // Euclidean/gridless distances are rounded to one decimal for display.
  return Math.round(units * 10) / 10;
}
