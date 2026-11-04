/**
 * Token model and the visibility/permission rules for it. Shared so the server
 * filters with the same logic the client uses to decide what to offer.
 */
import { isPointRevealed, type FogState } from "./fog.js";
import { isPointVisible, type ViewerSight } from "./vision.js";

export const TOKEN_LAYERS = ["map", "objects", "tokens", "dm"] as const;
export type TokenLayer = (typeof TOKEN_LAYERS)[number];

export const TOKEN_SHAPES = ["circle", "square"] as const;
export type TokenShape = (typeof TOKEN_SHAPES)[number];

/** Who may see a token's HP/AC/conditions. */
export const HP_VISIBILITY = ["everyone", "owners", "gm"] as const;
export type HpVisibility = (typeof HP_VISIBILITY)[number];

export interface TokenCondition {
  id: string;
  level?: number;
  source?: string;
  durationRounds: number | null;
}

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
  hpVisibility: HpVisibility;
  version: number;
}

/** Whether a viewer may see this token's HP, AC and conditions. */
export function canSeeTokenVitals(t: Pick<TokenState, "hpVisibility" | "ownerIds">, viewer: TokenViewer): boolean {
  if (viewer.isGameMaster || t.hpVisibility === "everyone") return true;
  return t.hpVisibility === "owners" && t.ownerIds.includes(viewer.userId);
}

export interface TokenViewer {
  userId: string;
  /** token.manageAll — sees and edits everything. */
  isGameMaster: boolean;
}

/**
 * Whether a viewer may receive this token at all. With dynamic vision on (`sight`), a
 * player also needs line of sight to it from one of their own tokens, in light or
 * darkvision; manual fog and vision both apply (the stricter wins).
 */
export function canSeeToken(t: TokenState, viewer: TokenViewer, fog: FogState, sight?: ViewerSight | null): boolean {
  if (viewer.isGameMaster) return true;
  if (t.hidden || t.layer === "dm") return false;
  if (t.ownerIds.includes(viewer.userId)) return true;
  // Map art and objects are drawn under fog anyway; tokens are filtered by their centre.
  const p = { x: t.x, y: t.y };
  if (!isPointRevealed(fog, p)) return false;
  // Map-layer art is part of the map, not a creature: darkness is drawn over it instead.
  if (sight?.enabled && t.layer !== "map" && !isPointVisible(sight, p)) return false;
  return true;
}

/** Fields a token owner (non-GM) may change. Everything else is GM-only. */
export const OWNER_EDITABLE_FIELDS = ["x", "y", "rotation"] as const;

export function canControlToken(t: TokenState, viewer: TokenViewer): boolean {
  if (viewer.isGameMaster) return true;
  return !t.locked && !t.hidden && t.ownerIds.includes(viewer.userId);
}
