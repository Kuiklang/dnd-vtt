import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID,
  canControlToken,
  canSeeToken,
  cellAt,
  cellDistance,
  isPointRevealed,
  normalizeShape,
  pathDistance,
  snapToGrid,
  type FogState,
  type GridSettings,
  type TokenState,
} from "../src/index.js";

const sq: GridSettings = { ...DEFAULT_GRID, size: 50 };
const hex: GridSettings = { ...DEFAULT_GRID, type: "hex", size: 50 };

describe("snapToGrid", () => {
  it("snaps medium tokens to square cell centres", () => {
    expect(snapToGrid({ x: 60, y: 140 }, sq)).toEqual({ x: 75, y: 125 });
  });
  it("snaps large (2x2) tokens to intersections", () => {
    expect(snapToGrid({ x: 60, y: 140 }, sq, 2)).toEqual({ x: 50, y: 150 });
  });
  it("respects grid offset", () => {
    expect(snapToGrid({ x: 12, y: 12 }, { ...sq, offsetX: 10, offsetY: 10 })).toEqual({ x: 35, y: 35 });
  });
  it("does nothing on gridless maps", () => {
    expect(snapToGrid({ x: 12.5, y: 7 }, { ...sq, type: "none" })).toEqual({ x: 12.5, y: 7 });
  });
  it("snaps to hex centres and is idempotent", () => {
    const a = snapToGrid({ x: 80, y: 40 }, hex);
    expect(snapToGrid(a, hex)).toEqual(a);
    expect(snapToGrid({ x: 2, y: -3 }, hex)).toEqual({ x: 0, y: 0 });
  });
});

describe("distance", () => {
  const a = { x: 25, y: 25 };
  const b = { x: 25 + 50 * 4, y: 25 + 50 * 2 }; // 4 right, 2 down
  it("uniform diagonals (5e default): 4 cells", () => {
    expect(cellDistance(a, b, sq, "uniform")).toBe(4);
    expect(pathDistance([a, b], sq, "uniform")).toBe(20);
  });
  it("alternating 5-10-5 diagonals: 2 diagonals cost 3", () => {
    expect(cellDistance(a, b, sq, "alternating")).toBe(5);
  });
  it("euclidean", () => {
    expect(cellDistance(a, b, sq, "euclidean")).toBeCloseTo(Math.hypot(4, 2));
  });
  it("hex distance counts hex steps", () => {
    const o = snapToGrid({ x: 0, y: 0 }, hex);
    const east3 = snapToGrid({ x: 150, y: 0 }, hex);
    expect(cellDistance(o, east3, hex, "uniform")).toBe(3);
  });
  it("sums multi-waypoint paths", () => {
    expect(pathDistance([a, { x: 125, y: 25 }, { x: 125, y: 125 }], sq, "uniform")).toBe(20);
  });
  it("reports cell coordinates", () => {
    expect(cellAt({ x: 120, y: 30 }, sq)).toEqual({ col: 2, row: 0 });
    expect(cellAt({ x: 1, y: 1 }, { ...sq, type: "none" })).toBeNull();
  });
});

describe("fog of war", () => {
  const fog: FogState = {
    enabled: true,
    ops: [
      { id: "1", mode: "reveal", shape: { kind: "rect", x: 0, y: 0, width: 100, height: 100 } },
      { id: "2", mode: "hide", shape: { kind: "circle", x: 50, y: 50, radius: 10 } },
      { id: "3", mode: "reveal", shape: { kind: "polygon", points: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 250, y: 100 }] } },
    ],
  };
  it("hides everything by default when enabled", () => {
    expect(isPointRevealed({ enabled: true, ops: [] }, { x: 1, y: 1 })).toBe(false);
  });
  it("shows everything when disabled", () => {
    expect(isPointRevealed({ enabled: false, ops: [] }, { x: 1, y: 1 })).toBe(true);
  });
  it("later shapes win", () => {
    expect(isPointRevealed(fog, { x: 10, y: 10 })).toBe(true);
    expect(isPointRevealed(fog, { x: 50, y: 52 })).toBe(false);
    expect(isPointRevealed(fog, { x: 250, y: 30 })).toBe(true);
    expect(isPointRevealed(fog, { x: 210, y: 90 })).toBe(false);
  });
  it("normalises negative rects and rejects degenerate shapes", () => {
    expect(normalizeShape({ kind: "rect", x: 10, y: 10, width: -5, height: -5 })).toEqual({ kind: "rect", x: 5, y: 5, width: 5, height: 5 });
    expect(normalizeShape({ kind: "circle", x: 0, y: 0, radius: 0 })).toBeNull();
    expect(normalizeShape({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBeNull();
    expect(normalizeShape({ kind: "rect", x: Number.NaN, y: 0, width: 5, height: 5 })).toBeNull();
  });
});

describe("token visibility and control", () => {
  const base: TokenState = {
    id: "t", sceneId: "s", characterId: null, name: "Goblin", imageAssetId: null, x: 500, y: 500, size: 1, rotation: 0,
    layer: "tokens", shape: "circle", color: "#aa0000", borderColor: "#000000", hidden: false, locked: false, showName: true,
    ownerIds: ["p1"], version: 1,
  };
  const fog: FogState = { enabled: true, ops: [] };
  const gm = { userId: "dm", isGameMaster: true };
  const p1 = { userId: "p1", isGameMaster: false };
  const p2 = { userId: "p2", isGameMaster: false };
  it("GM sees everything", () => {
    expect(canSeeToken({ ...base, hidden: true, layer: "dm" }, gm, fog)).toBe(true);
  });
  it("players never receive hidden or DM-layer tokens, even their own", () => {
    expect(canSeeToken({ ...base, hidden: true }, p1, fog)).toBe(false);
    expect(canSeeToken({ ...base, layer: "dm" }, p1, fog)).toBe(false);
  });
  it("owners see their token under fog; others don't", () => {
    expect(canSeeToken(base, p1, fog)).toBe(true);
    expect(canSeeToken(base, p2, fog)).toBe(false);
    expect(canSeeToken(base, p2, { enabled: false, ops: [] })).toBe(true);
  });
  it("only owners control unlocked tokens", () => {
    expect(canControlToken(base, p1)).toBe(true);
    expect(canControlToken(base, p2)).toBe(false);
    expect(canControlToken({ ...base, locked: true }, p1)).toBe(false);
    expect(canControlToken({ ...base, locked: true }, gm)).toBe(true);
  });
});
