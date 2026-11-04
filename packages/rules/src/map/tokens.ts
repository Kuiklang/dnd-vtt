/**
 * Token model and the visibility/permission rules for it. Shared so the server
 * filters with the same logic the client uses to decide what to offer.
 */
import { isPointRevealed, type FogState } from "./fog.js";

export const TOKEN_LAYERS = ["map", "objects", "tokens", "dm"] as const;
export type TokenLayer = (typeof TOKEN_LAYERS)[number];

export const TOKEN_SHAPES = ["circle", "square"] as const;
export type TokenShape = (typeof TOKEN_SHAPES)[number];

export interface TokenState {
  id: string;
  sceneId: string;
  characterId: string | null;
  name: string;
  imageAssetId: string | null;
  /** Centre position in scene pixels. */
  x: number;
  y: number;
  /** Footprint in grid cells (1 = medium, 2 = large, 0.5 = tiny...). */
  size: number;
  rotation: number;
  layer: TokenLayer;
  shape: TokenShape;
  color: string;
  borderColor: string;
  hidden: boolean;
  locked: boolean;
  showName: boolean;
  /** Users allowed to move/control this token (besides GMs). */
  ownerIds: string[];
  version: number;
}

export interface TokenViewer {
  userId: string;
  /** token.manageAll — sees and edits everything. */
  isGameMaster: boolean;
}

/** Whether a viewer may receive this token at all. */
export function canSeeToken(t: TokenState, viewer: TokenViewer, fog: FogState): boolean {
  if (viewer.isGameMaster) return true;
  if (t.hidden || t.layer === "dm") return false;
  if (t.ownerIds.includes(viewer.userId)) return true;
  // Map art and objects are drawn under fog anyway; tokens are filtered by their centre.
  return isPointRevealed(fog, { x: t.x, y: t.y });
}

/** Fields a token owner (non-GM) may change. Everything else is GM-only. */
export const OWNER_EDITABLE_FIELDS = ["x", "y", "rotation"] as const;

export function canControlToken(t: TokenState, viewer: TokenViewer): boolean {
  if (viewer.isGameMaster) return true;
  return !t.locked && !t.hidden && t.ownerIds.includes(viewer.userId);
}
