/**
 * Dynamic lighting and vision (Phase 8). Walls block sight, tokens see from their centre,
 * light sources light up an area, and darkvision lets a token see in the dark within a
 * range. Pure functions shared by the server (which decides which tokens a player
 * receives) and the client (which draws the darkness), so they always agree.
 *
 * Rules used (SRD 5.1): bright light lets you see normally; dim light is still visible
 * (lightly obscured); darkness can't be seen into without darkvision. Darkvision treats
 * darkness as dim light within its range.
 */
import type { Point } from "./geometry.js";

export const WALL_KINDS = ["wall", "door", "secret"] as const;
/** wall: always blocks. door: blocks unless open. secret: a door players see as a plain wall. */
export type WallKind = (typeof WALL_KINDS)[number];

export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: WallKind;
  open: boolean;
  /** Locked doors can only be opened by the DM. */
  locked: boolean;
}

export const AMBIENT_LIGHTS = ["bright", "dim", "dark"] as const;
export type AmbientLight = (typeof AMBIENT_LIGHTS)[number];

export interface SceneVision {
  /** Off = everyone sees the whole map (only manual fog applies). */
  enabled: boolean;
  ambient: AmbientLight;
}

export const DEFAULT_SCENE_VISION: SceneVision = { enabled: false, ambient: "bright" };

/** A token's senses, in game units (feet). */
export interface TokenSight {
  darkvision: number;
}

/** Light a token gives off, in game units: bright radius, then dim light out to `dim`. */
export interface TokenLight {
  bright: number;
  dim: number;
  color: string;
}

/** Common light sources from the SRD (radii in feet: bright, then dim to the outer edge). */
export const LIGHT_PRESETS: Record<string, { bright: number; dim: number }> = {
  candle: { bright: 5, dim: 10 },
  torch: { bright: 20, dim: 40 },
  lamp: { bright: 15, dim: 45 },
  lantern: { bright: 30, dim: 60 },
  light: { bright: 20, dim: 40 },
  daylight: { bright: 60, dim: 120 },
};

export const MAX_WALLS = 2000;
export const MAX_SIGHT_FT = 1000;

export function blocksSight(w: Wall): boolean {
  return w.kind === "wall" || !w.open;
}

/** What a player may know about a wall: secret doors look like ordinary walls. */
export function wallForPlayer(w: Wall): Wall {
  return w.kind === "secret" ? { ...w, kind: "wall", open: false, locked: false } : w;
}

const EPS = 1e-9;

/** Where segment p→p+r meets q→q+s, as fractions along each (null when parallel). */
function intersect(p: Point, r: Point, q: Point, s: Point): { t: number; u: number } | null {
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPS) return null;
  const qp = { x: q.x - p.x, y: q.y - p.y };
  return { t: (qp.x * s.y - qp.y * s.x) / denom, u: (qp.x * r.y - qp.y * r.x) / denom };
}

/**
 * Whether `b` can be seen from `a`: no sight-blocking wall crosses the segment between them.
 * Touching a wall's end exactly (a corner) does not block, so tokens can see along walls.
 */
export function hasLineOfSight(a: Point, b: Point, walls: readonly Wall[]): boolean {
  const r = { x: b.x - a.x, y: b.y - a.y };
  for (const w of walls) {
    if (!blocksSight(w)) continue;
    const hit = intersect(a, r, { x: w.x1, y: w.y1 }, { x: w.x2 - w.x1, y: w.y2 - w.y1 });
    if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6 && hit.u > 1e-6 && hit.u < 1 - 1e-6) return false;
  }
  return true;
}

/**
 * The area visible from `origin`, as a polygon (ray casting toward every wall end plus a
 * ring of rays so curved limits look round). Limited to `radius` and the scene bounds.
 */
export function visibilityPolygon(origin: Point, walls: readonly Wall[], radius: number, bounds: { width: number; height: number }): Point[] {
  const blocking = walls.filter(blocksSight);
  const segs = blocking.map((w) => ({ a: { x: w.x1, y: w.y1 }, d: { x: w.x2 - w.x1, y: w.y2 - w.y1 } }));
  // Scene edges act as walls so rays always end somewhere.
  const { width: W, height: H } = bounds;
  segs.push({ a: { x: 0, y: 0 }, d: { x: W, y: 0 } }, { a: { x: W, y: 0 }, d: { x: 0, y: H } }, { a: { x: W, y: H }, d: { x: -W, y: 0 } }, { a: { x: 0, y: H }, d: { x: 0, y: -H } });
  const angles: number[] = [];
  for (let i = 0; i < 72; i++) angles.push((i / 72) * Math.PI * 2 - Math.PI);
  const corners = [...blocking.flatMap((w) => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]), { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  for (const c of corners) {
    if (Math.hypot(c.x - origin.x, c.y - origin.y) > radius + 1) continue;
    const a = Math.atan2(c.y - origin.y, c.x - origin.x);
    angles.push(a - 1e-4, a, a + 1e-4);
  }
  angles.sort((x, y) => x - y);
  const pts: Point[] = [];
  for (const a of angles) {
    const r = { x: Math.cos(a), y: Math.sin(a) };
    let best = radius;
    for (const s of segs) {
      const hit = intersect(origin, r, s.a, s.d);
      if (hit && hit.t > 0 && hit.u >= -1e-9 && hit.u <= 1 + 1e-9 && hit.t < best) best = hit.t;
    }
    pts.push({ x: origin.x + r.x * best, y: origin.y + r.y * best });
  }
  return pts;
}

/** A point a player sees from (their token), with darkvision converted to pixels. */
export interface Eye extends Point {
  darkvisionPx: number;
}

/** A light on the map, radii in pixels. */
export interface LightSource extends Point {
  brightPx: number;
  dimPx: number;
  color: string;
}

/** Everything needed to decide what one player can see on a scene. */
export interface ViewerSight {
  enabled: boolean;
  ambient: AmbientLight;
  walls: Wall[];
  eyes: Eye[];
  lights: LightSource[];
}

export interface SightToken extends Point {
  ownerIds: string[];
  hidden: boolean;
  layer: string;
  sight: TokenSight | null;
  light: TokenLight | null;
}

/**
 * Builds what `userId` sees from: the tokens they own are their eyes. Lights come from
 * every token players can know about (hidden tokens don't reveal their light).
 */
export function buildViewerSight(
  vision: SceneVision,
  walls: Wall[],
  tokens: readonly SightToken[],
  userId: string,
  pxPerUnit: number,
): ViewerSight {
  const eyes: Eye[] = [];
  const lights: LightSource[] = [];
  for (const t of tokens) {
    if (t.hidden || t.layer === "dm") continue;
    if (t.ownerIds.includes(userId)) eyes.push({ x: t.x, y: t.y, darkvisionPx: (t.sight?.darkvision ?? 0) * pxPerUnit });
    if (t.light && (t.light.bright > 0 || t.light.dim > 0))
      lights.push({ x: t.x, y: t.y, brightPx: t.light.bright * pxPerUnit, dimPx: Math.max(t.light.bright, t.light.dim) * pxPerUnit, color: t.light.color });
  }
  return { enabled: vision.enabled, ambient: vision.ambient, walls, eyes, lights };
}

/** Whether a point is lit (by ambient light or a light source that can reach it). */
export function isPointLit(s: Pick<ViewerSight, "ambient" | "lights" | "walls">, p: Point): boolean {
  if (s.ambient !== "dark") return true;
  return s.lights.some((l) => Math.hypot(l.x - p.x, l.y - p.y) <= l.dimPx && hasLineOfSight(l, p, s.walls));
}

/** Whether the player can see a point: an eye has line of sight and the point is lit or in darkvision range. */
export function isPointVisible(s: ViewerSight, p: Point): boolean {
  if (!s.enabled) return true;
  for (const e of s.eyes) {
    if (!hasLineOfSight(e, p, s.walls)) continue;
    if (Math.hypot(e.x - p.x, e.y - p.y) <= e.darkvisionPx || isPointLit(s, p)) return true;
  }
  return false;
}

/** Normalises a wall from untrusted input (finite, non-zero length, inside a sane range). */
export function normalizeWall(w: { x1: number; y1: number; x2: number; y2: number }): { x1: number; y1: number; x2: number; y2: number } | null {
  const vals = [w.x1, w.y1, w.x2, w.y2];
  if (!vals.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6)) return null;
  if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 1) return null;
  const r = (v: number) => Math.round(v * 10) / 10;
  return { x1: r(w.x1), y1: r(w.y1), x2: r(w.x2), y2: r(w.y2) };
}
