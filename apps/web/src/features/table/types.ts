import type { ActionEconomy, Defenses, FogShape, GridSettings, HpState, SceneVision, TokenCondition, TokenLight, TokenSight, TokenState, Wall } from "@vtt/rules";

export interface SceneDto {
  id: string;
  campaignId: string;
  name: string;
  backgroundUrl: string | null;
  backgroundAssetId: string | null;
  backgroundColor: string;
  width: number;
  height: number;
  grid: GridSettings;
  fogEnabled: boolean;
  dmNotes?: string;
  /** DM only: music that starts when this scene is shown. */
  music?: { kind: "playlist" | "track"; id: string } | null;
  sortOrder: number;
  version: number;
  isActive: boolean;
  updatedAt: string;
  /** Dynamic lighting & vision. */
  vision: SceneVision;
}

/** HP/AC/conditions as this viewer may see them. */
export interface TokenVitals {
  hp: HpState | null;
  ac: number | null;
  conditions: TokenCondition[];
  defenses: Defenses;
  source: "character" | "token";
  initiativeBonus?: number;
}

export interface TokenStats {
  hp: HpState;
  ac: number | null;
  initiativeBonus: number;
  conditions: TokenCondition[];
  defenses: Defenses;
  /** Set when placed from the bestiary or a campaign monster; GM-only. */
  statBlock?: StatBlockRef | null;
}

export interface StatBlockRef {
  type: "srd" | "character";
  id: string;
}

export interface TokenDto extends TokenState {
  imageUrl: string | null;
  vitals: TokenVitals | null;
  /** Vitals exist but the server withheld them from this viewer. */
  vitalsHidden: boolean;
  /** GM-only stat block link (always null for players). */
  statBlock?: StatBlockRef | null;
  sight?: TokenSight | null;
  light?: TokenLight | null;
}

export interface CombatantDto {
  id: string;
  tokenId: string | null;
  characterId: string | null;
  name: string;
  initiative: number | null;
  initiativeBonus: number;
  hidden: boolean;
  defeated: boolean;
  actions: ActionEconomy;
  ownerIds: string[];
  vitals: TokenVitals | null;
  vitalsHidden: boolean;
}

export interface CombatDto {
  id: string;
  sceneId: string | null;
  round: number;
  turnIndex: number;
  activeCombatantId: string | null;
  version: number;
  combatants: CombatantDto[];
}

export interface FogOpDto {
  id: string;
  mode: "reveal" | "hide";
  shape: FogShape;
}

export interface TemplateDto {
  id: string;
  sceneId: string;
  ownerId: string | null;
  shape: "circle" | "cone" | "line" | "square";
  x: number;
  y: number;
  size: number;
  width: number;
  angle: number;
  color: string;
  label: string;
  hidden: boolean;
}

export interface SceneState {
  scene: SceneDto;
  tokens: TokenDto[];
  fog: FogOpDto[];
  templates: TemplateDto[];
  walls?: Wall[];
}

export interface AssetDto {
  id: string;
  kind: string;
  mime: string;
  width: number | null;
  height: number | null;
  url: string;
}

export type Tool = "select" | "pan" | "measure" | "fog-reveal" | "fog-hide" | "template" | "wall";
export type FogShapeKind = FogShape["kind"];
