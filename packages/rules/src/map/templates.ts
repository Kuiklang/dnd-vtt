/**
 * Area-of-effect templates (Phase 7). A template has an origin, a size in game
 * units (feet) and, for cones and lines, a direction. Shapes follow the 5e rules:
 * a cone's width at any point equals its distance from the origin (~53°), a cube/
 * square is centred on the origin here (placed where the DM clicks), a line has
 * a length and a width. A token is "in" the area when its centre is.
 */
import type { GridSettings, Point } from "./geometry.js";

export const TEMPLATE_SHAPES = ["circle", "cone", "line", "square"] as const;
export type TemplateShape = (typeof TEMPLATE_SHAPES)[number];

export interface MapTemplate {
  shape: TemplateShape;
  /** Origin in scene px (centre for circle/square, apex for cone, start for line). */
  x: number;
  y: number;
  /** Radius (circle), side (square) or length (cone/line), in game units. */
  size: number;
  /** Line width in game units. */
  width: number;
  /** Direction in degrees (0 = east/right, clockwise because screen y points down). */
  angle: number;
}

/** Pixels per game unit (e.g. 70 px per cell / 5 ft per cell = 14 px/ft). */
export const pxPerUnit = (g: Pick<GridSettings, "size" | "unitsPerCell">) => g.size / Math.max(0.0001, g.unitsPerCell);

/** Half-angle of a 5e cone: width equals length, so tan(half) = 0.5. */
export const CONE_HALF_ANGLE = Math.atan(0.5);

/** Maps a spell's area (SRD shape) onto a map template shape. */
export function templateShapeForArea(shape: "sphere" | "cone" | "line" | "cube" | "cylinder"): TemplateShape {
  return shape === "sphere" || shape === "cylinder" ? "circle" : shape === "cube" ? "square" : shape;
}

export function pointInTemplate(t: MapTemplate, p: Point, g: Pick<GridSettings, "size" | "unitsPerCell">): boolean {
  const k = pxPerUnit(g);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const eps = 0.5;
  switch (t.shape) {
    case "circle":
      return Math.hypot(dx, dy) <= t.size * k + eps;
    case "square": {
      const half = (t.size * k) / 2 + eps;
      return Math.abs(dx) <= half && Math.abs(dy) <= half;
    }
    case "cone":
    case "line": {
      const a = (t.angle * Math.PI) / 180;
      // Rotate into the template's frame: u along the direction, v across it.
      const u = dx * Math.cos(a) + dy * Math.sin(a);
      const v = -dx * Math.sin(a) + dy * Math.cos(a);
      const len = t.size * k;
      if (u < -eps || u > len + eps) return false;
      if (t.shape === "line") return Math.abs(v) <= (t.width * k) / 2 + eps;
      return Math.abs(v) <= u * Math.tan(CONE_HALF_ANGLE) + eps;
    }
  }
}

/** Ids of the tokens whose centres lie inside the template. */
export function tokensInTemplate<T extends { id: string; x: number; y: number }>(t: MapTemplate, tokens: T[], g: Pick<GridSettings, "size" | "unitsPerCell">): string[] {
  return tokens.filter((tk) => pointInTemplate(t, tk, g)).map((tk) => tk.id);
}

/** Polygon outline in scene px for drawing cones, lines and squares. */
export function templateOutline(t: MapTemplate, g: Pick<GridSettings, "size" | "unitsPerCell">): Point[] {
  const k = pxPerUnit(g);
  const a = (t.angle * Math.PI) / 180;
  const rot = (u: number, v: number): Point => ({ x: t.x + u * Math.cos(a) - v * Math.sin(a), y: t.y + u * Math.sin(a) + v * Math.cos(a) });
  const len = t.size * k;
  switch (t.shape) {
    case "square": {
      const h = len / 2;
      return [
        { x: t.x - h, y: t.y - h },
        { x: t.x + h, y: t.y - h },
        { x: t.x + h, y: t.y + h },
        { x: t.x - h, y: t.y + h },
      ];
    }
    case "line": {
      const w = (t.width * k) / 2;
      return [rot(0, -w), rot(len, -w), rot(len, w), rot(0, w)];
    }
    case "cone": {
      const w = len * Math.tan(CONE_HALF_ANGLE);
      return [rot(0, 0), rot(len, -w), rot(len, w)];
    }
    case "circle": {
      const pts: Point[] = [];
      for (let i = 0; i < 48; i++) pts.push({ x: t.x + Math.cos((i / 48) * 2 * Math.PI) * len, y: t.y + Math.sin((i / 48) * 2 * Math.PI) * len });
      return pts;
    }
  }
}
