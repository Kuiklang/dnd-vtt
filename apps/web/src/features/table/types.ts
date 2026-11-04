import type { FogShape, GridSettings, TokenState } from "@vtt/rules";

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
  sortOrder: number;
  version: number;
  isActive: boolean;
  updatedAt: string;
}

export interface TokenDto extends TokenState {
  imageUrl: string | null;
}

export interface FogOpDto {
  id: string;
  mode: "reveal" | "hide";
  shape: FogShape;
}

export interface SceneState {
  scene: SceneDto;
  tokens: TokenDto[];
  fog: FogOpDto[];
}

export interface AssetDto {
  id: string;
  kind: string;
  mime: string;
  width: number | null;
  height: number | null;
  url: string;
}

export type Tool = "select" | "pan" | "measure" | "fog-reveal" | "fog-hide";
export type FogShapeKind = FogShape["kind"];
