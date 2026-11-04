import { describe, expect, it } from "vitest";
import {
  buildViewerSight,
  canSeeToken,
  hasLineOfSight,
  isPointVisible,
  normalizeWall,
  pxPerUnit,
  visibilityPolygon,
  wallForPlayer,
  pointInPolygon,
  type SightToken,
  type TokenState,
  type Wall,
} from "../src/index.js";

const wall = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Wall> = {}): Wall => ({ id: `${x1},${y1}`, x1, y1, x2, y2, kind: "wall", open: false, locked: false, ...extra });
const me = "u1";
const hero = (x: number, y: number, extra: Partial<SightToken> = {}): SightToken => ({ x, y, ownerIds: [me], hidden: false, layer: "tokens", sight: null, light: null, ...extra });
// 70 px per 5 ft cell = 14 px per foot.
const PX = pxPerUnit({ size: 70, unitsPerCell: 5 });

describe("line of sight", () => {
  it("is blocked by walls and closed doors but not open doors", () => {
    const w = [wall(100, 0, 100, 200)];
    expect(hasLineOfSight({ x: 50, y: 100 }, { x: 150, y: 100 }, w)).toBe(false);
    expect(hasLineOfSight({ x: 50, y: 100 }, { x: 150, y: 100 }, [wall(100, 0, 100, 200, { kind: "door", open: true })])).toBe(true);
    expect(hasLineOfSight({ x: 50, y: 100 }, { x: 150, y: 100 }, [wall(100, 0, 100, 200, { kind: "door", open: false })])).toBe(false);
    // Passing beside the end of a wall is fine.
    expect(hasLineOfSight({ x: 50, y: 250 }, { x: 150, y: 250 }, w)).toBe(true);
  });

  it("builds a visibility polygon that stops at walls", () => {
    const poly = visibilityPolygon({ x: 50, y: 100 }, [wall(100, 0, 100, 200)], 10000, { width: 400, height: 200 });
    expect(pointInPolygon({ x: 80, y: 100 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 300, y: 100 }, poly)).toBe(false);
  });
});

describe("what a player sees", () => {
  const scene = { width: 1000, height: 1000 };
  it("sees everything in line of sight when the scene is lit", () => {
    const s = buildViewerSight({ enabled: true, ambient: "bright" }, [wall(500, 0, 500, 1000)], [hero(100, 100)], me, PX);
    expect(isPointVisible(s, { x: 400, y: 900 })).toBe(true);
    expect(isPointVisible(s, { x: 600, y: 100 })).toBe(false);
    void scene;
  });

  it("needs light or darkvision in the dark", () => {
    const dark = { enabled: true, ambient: "dark" as const };
    const plain = buildViewerSight(dark, [], [hero(100, 100)], me, PX);
    expect(isPointVisible(plain, { x: 150, y: 100 })).toBe(false);
    // Darkvision 60 ft = 840 px.
    const dv = buildViewerSight(dark, [], [hero(100, 100, { sight: { darkvision: 60 } })], me, PX);
    expect(isPointVisible(dv, { x: 900, y: 100 })).toBe(true);
    expect(isPointVisible(dv, { x: 960, y: 100 })).toBe(false);
    // A torch (20/40 ft) carried by someone else lights the area around it.
    const torch = { ownerIds: ["u2"], hidden: false, layer: "tokens", x: 600, y: 600, sight: null, light: { bright: 20, dim: 40, color: "#ffb347" } };
    const lit = buildViewerSight(dark, [], [hero(100, 100), torch], me, PX);
    expect(isPointVisible(lit, { x: 700, y: 600 })).toBe(true);
    expect(isPointVisible(lit, { x: 100, y: 900 })).toBe(false);
    // A wall between the torch and the spot keeps it dark.
    const walled = buildViewerSight(dark, [wall(650, 0, 650, 1000)], [hero(700, 100), torch], me, PX);
    expect(isPointVisible(walled, { x: 700, y: 600 })).toBe(false);
  });

  it("filters tokens for players and never for the DM", () => {
    const goblin = { id: "g", sceneId: "s", characterId: null, name: "Goblin", imageAssetId: null, x: 800, y: 100, size: 1, rotation: 0, layer: "tokens", shape: "circle", color: "", borderColor: "", hidden: false, locked: false, showName: true, ownerIds: [], hpVisibility: "gm", version: 1 } as TokenState;
    const s = buildViewerSight({ enabled: true, ambient: "bright" }, [wall(500, 0, 500, 1000)], [hero(100, 100)], me, PX);
    const fog = { enabled: false, ops: [] };
    expect(canSeeToken(goblin, { userId: me, isGameMaster: false }, fog, s)).toBe(false);
    expect(canSeeToken(goblin, { userId: me, isGameMaster: true }, fog, s)).toBe(true);
    expect(canSeeToken({ ...goblin, x: 300 }, { userId: me, isGameMaster: false }, fog, s)).toBe(true);
    // Vision off: only fog matters.
    expect(canSeeToken(goblin, { userId: me, isGameMaster: false }, fog, { ...s, enabled: false })).toBe(true);
  });

  it("hides secret doors from players and checks wall input", () => {
    expect(wallForPlayer(wall(0, 0, 10, 0, { kind: "secret", open: true }))).toMatchObject({ kind: "wall", open: false });
    expect(normalizeWall({ x1: 0, y1: 0, x2: 0.2, y2: 0 })).toBeNull();
    expect(normalizeWall({ x1: 0, y1: 0, x2: Infinity, y2: 0 })).toBeNull();
    expect(normalizeWall({ x1: 0.123, y1: 0, x2: 10, y2: 0 })).toEqual({ x1: 0.1, y1: 0, x2: 10, y2: 0 });
  });
});
