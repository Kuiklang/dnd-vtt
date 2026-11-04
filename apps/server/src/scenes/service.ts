import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  DEFAULT_GRID,
  MAX_FOG_OPS,
  OWNER_EDITABLE_FIELDS,
  NO_DEFENSES,
  canControlToken,
  canSeeToken,
  canSeeTokenVitals,
  type CharacterData,
  type CharacterKind,
  type Defenses,
  type HpState,
  type HpVisibility,
  type TokenCondition,
  normalizeShape,
  type FogShape,
  type FogState,
  type GridSettings,
  type TokenLayer,
  type TokenShape,
  type TokenState,
  type TokenViewer,
  type SceneVision,
  type TokenLight,
  type TokenSight,
  type ViewerSight,
  type Wall,
  type WallKind,
  MAX_WALLS,
  buildViewerSight,
  isPointVisible,
  normalizeWall,
  pxPerUnit,
  wallForPlayer,
} from "@vtt/rules";
import type { Db } from "../db/client.js";
import { audioTracks, campaigns, characters, fogOps, mapTemplates, mapWalls, playlists, scenes, tokens, type MapTemplateRow, type MapWallRow, type SceneMusic, type SceneRow, type StatBlockRef, type TokenRow, type TokenStats } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { CampaignService, Membership } from "../campaigns/service.js";
import { assetUrl, type AssetService } from "../assets/service.js";

export const MAX_SCENES_PER_CAMPAIGN = 200;
export const MAX_TOKENS_PER_SCENE = 500;
/** Scenes are capped so a typo can't allocate an absurd canvas on every client. */
export const MAX_SCENE_PX = 16384;

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
  /** Only present for viewers with dmNotes.view. */
  dmNotes?: string;
  /** Scene music; only for viewers with dmNotes.view (it's DM prep). */
  music?: SceneMusic | null;
  sortOrder: number;
  version: number;
  isActive: boolean;
  updatedAt: string;
  /** Dynamic lighting & vision. */
  vision: SceneVision;
}

/** HP/AC/conditions shown on a token; null when not tracked or hidden from the viewer. */
export interface TokenVitals {
  hp: HpState | null;
  ac: number | null;
  conditions: TokenCondition[];
  defenses: Defenses;
  /** Where the numbers live: the linked character sheet or the token itself. */
  source: "character" | "token";
  /** Token-tracked creatures only (characters derive it from DEX). */
  initiativeBonus?: number;
}

export interface TokenDto extends TokenState {
  imageUrl: string | null;
  vitals: TokenVitals | null;
  /** True when vitals exist but were withheld from this viewer. */
  vitalsHidden: boolean;
  /** GM-only: the stat block this token was placed from (null for players). */
  statBlock: StatBlockRef | null;
  sight: TokenSight | null;
  light: TokenLight | null;
}

export interface LinkedCharacter {
  data: CharacterData;
  kind: CharacterKind;
}

export function vitalsOf(t: TokenRow, character: LinkedCharacter | null): TokenVitals | null {
  if (character) {
    return {
      hp: character.data.hp,
      ac: character.data.armorClass,
      conditions: character.data.conditions,
      defenses: character.data.defenses ?? NO_DEFENSES,
      source: "character",
    };
  }
  if (!t.stats) return null;
  return { hp: t.stats.hp, ac: t.stats.ac, conditions: t.stats.conditions, defenses: t.stats.defenses ?? NO_DEFENSES, source: "token", initiativeBonus: t.stats.initiativeBonus };
}

/** Copy of a token as one viewer may see it (vitals withheld per hpVisibility). */
export function redactToken(t: TokenDto, viewer: TokenViewer): TokenDto {
  // Which stat block a token uses is DM knowledge (it can reveal a disguised creature).
  const base = viewer.isGameMaster || !t.statBlock ? t : { ...t, statBlock: null };
  if (!base.vitals || canSeeTokenVitals(base, viewer)) return base;
  return { ...base, vitals: null, vitalsHidden: true };
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
  templates: TemplateDto[];
  /** Walls and doors (secret doors are sent to players as plain walls). */
  walls: Wall[];
}

export interface TemplateDto {
  id: string;
  sceneId: string;
  ownerId: string | null;
  shape: MapTemplateRow["shape"];
  x: number;
  y: number;
  size: number;
  width: number;
  angle: number;
  color: string;
  label: string;
  hidden: boolean;
}

export interface TemplateInput {
  shape: MapTemplateRow["shape"];
  x: number;
  y: number;
  size: number;
  width: number;
  angle: number;
  color: string;
  label: string;
  hidden: boolean;
}

export const MAX_TEMPLATES_PER_SCENE = 60;

export const toTemplateDto = (t: MapTemplateRow): TemplateDto => ({
  id: t.id,
  sceneId: t.sceneId,
  ownerId: t.ownerId,
  shape: t.shape,
  x: t.x,
  y: t.y,
  size: t.size,
  width: t.width,
  angle: t.angle,
  color: t.color,
  label: t.label,
  hidden: t.hidden,
});

export interface SceneInput {
  name: string;
  backgroundAssetId: string | null;
  backgroundColor: string;
  width: number;
  height: number;
  grid: Partial<GridSettings>;
  fogEnabled: boolean;
  dmNotes: string;
  music: SceneMusic | null;
  sortOrder: number;
  vision: SceneVision;
}

export interface TokenInput {
  characterId: string | null;
  name: string;
  imageAssetId: string | null;
  x: number;
  y: number;
  size: number;
  rotation: number;
  layer: TokenLayer;
  shape: TokenShape;
  color: string;
  borderColor: string;
  hidden: boolean;
  locked: boolean;
  showName: boolean;
  ownerIds: string[];
  hpVisibility: HpVisibility;
  stats: TokenStats | null;
  sight: TokenSight | null;
  light: TokenLight | null;
}

export const toWall = (w: MapWallRow): Wall => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind, open: w.open, locked: w.locked });

/** The walls one viewer may know about. */
export const wallsFor = (walls: Wall[], isGM: boolean): Wall[] => (isGM ? walls : walls.map(wallForPlayer));

/** What one player sees from on a scene (null for GMs, who see everything). */
export function sightFor(scene: SceneRow, walls: Wall[], all: TokenDto[], viewer: TokenViewer): ViewerSight | null {
  if (viewer.isGameMaster || !scene.vision?.enabled) return null;
  return buildViewerSight(scene.vision, walls, all, viewer.userId, pxPerUnit(scene.grid));
}

export const viewerOf = (m: Membership): TokenViewer => ({ userId: m.member.userId, isGameMaster: m.caps.has("token.manageAll") });

export function toSceneDto(s: SceneRow, activeSceneId: string | null, showNotes: boolean): SceneDto {
  return {
    id: s.id,
    campaignId: s.campaignId,
    name: s.name,
    backgroundUrl: s.backgroundAssetId ? assetUrl(s.backgroundAssetId) : null,
    backgroundAssetId: s.backgroundAssetId,
    backgroundColor: s.backgroundColor,
    width: s.width,
    height: s.height,
    grid: s.grid,
    fogEnabled: s.fogEnabled,
    ...(showNotes ? { dmNotes: s.dmNotes, music: s.music ?? null } : {}),
    sortOrder: s.sortOrder,
    version: s.version,
    isActive: s.id === activeSceneId,
    updatedAt: s.updatedAt.toISOString(),
    vision: s.vision ?? { enabled: false, ambient: "bright" },
  };
}

export function toTokenDto(t: TokenRow, character: LinkedCharacter | null = null): TokenDto {
  const portraitUrl = character?.data.portraitUrl || null;
  return {
    id: t.id,
    sceneId: t.sceneId,
    characterId: t.characterId,
    name: t.name,
    imageAssetId: t.imageAssetId,
    imageUrl: t.imageAssetId ? assetUrl(t.imageAssetId) : portraitUrl || null,
    x: t.x,
    y: t.y,
    size: t.size,
    rotation: t.rotation,
    layer: t.layer,
    shape: t.shape,
    color: t.color,
    borderColor: t.borderColor,
    hidden: t.hidden,
    locked: t.locked,
    showName: t.showName,
    ownerIds: t.ownerIds,
    hpVisibility: t.hpVisibility,
    version: t.version,
    vitals: vitalsOf(t, character),
    vitalsHidden: false,
    statBlock: t.stats?.statBlock ?? null,
    sight: t.sight ?? null,
    light: t.light ?? null,
  };
}

export class SceneService {
  constructor(
    private readonly db: Db,
    private readonly campaigns: CampaignService,
    private readonly assets: AssetService,
  ) {}

  // ---- Scenes ------------------------------------------------------------

  private async sceneRow(campaignId: string, sceneId: string): Promise<SceneRow> {
    const [row] = await this.db
      .select()
      .from(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.campaignId, campaignId), isNull(scenes.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Scene");
    return row;
  }

  /** Scene row without permission checks (realtime broadcast use only). */
  async viewableRaw(campaignId: string, sceneId: string): Promise<SceneRow | null> {
    return this.sceneRow(campaignId, sceneId).catch(() => null);
  }

  async activeSceneId(campaignId: string): Promise<string | null> {
    const [c] = await this.db.select({ id: campaigns.activeSceneId }).from(campaigns).where(eq(campaigns.id, campaignId));
    return c?.id ?? null;
  }

  /** Loads a scene the viewer may open: GMs any scene, others only the active one. */
  async viewable(m: Membership, sceneId: string): Promise<SceneRow> {
    const row = await this.sceneRow(m.campaign.id, sceneId);
    if (!m.caps.has("map.manage") && m.campaign.activeSceneId !== row.id) throw notFound("Scene");
    return row;
  }

  async list(m: Membership): Promise<SceneDto[]> {
    const showNotes = m.caps.has("dmNotes.view");
    if (!m.caps.has("map.manage")) {
      if (!m.campaign.activeSceneId) return [];
      const row = await this.sceneRow(m.campaign.id, m.campaign.activeSceneId).catch(() => null);
      return row ? [toSceneDto(row, m.campaign.activeSceneId, showNotes)] : [];
    }
    const rows = await this.db
      .select()
      .from(scenes)
      .where(and(eq(scenes.campaignId, m.campaign.id), isNull(scenes.deletedAt)))
      .orderBy(asc(scenes.sortOrder), asc(scenes.createdAt));
    return rows.map((r) => toSceneDto(r, m.campaign.activeSceneId, showNotes));
  }

  async create(m: Membership, input: Partial<SceneInput> & { name: string }): Promise<SceneRow> {
    if (!m.caps.has("map.manage")) throw forbidden("Only the DM can create maps");
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(scenes)
      .where(and(eq(scenes.campaignId, m.campaign.id), isNull(scenes.deletedAt)))) as [{ n: number }];
    if (n >= MAX_SCENES_PER_CAMPAIGN) throw badRequest(`A campaign can have at most ${MAX_SCENES_PER_CAMPAIGN} maps`);
    const grid = { ...DEFAULT_GRID, ...input.grid };
    let width = input.width;
    let height = input.height;
    if (input.backgroundAssetId) {
      const asset = await this.assets.requireCampaignAsset(input.backgroundAssetId, m.campaign.id, m.member.userId);
      // Default the scene to the image's native size.
      width ??= asset.width ?? undefined;
      height ??= asset.height ?? undefined;
    }
    width ??= grid.size * 30;
    height ??= grid.size * 20;
    this.checkSize(width, height);
    const [row] = await this.db
      .insert(scenes)
      .values({
        campaignId: m.campaign.id,
        name: input.name,
        backgroundAssetId: input.backgroundAssetId ?? null,
        backgroundColor: input.backgroundColor ?? "#1a1714",
        width,
        height,
        grid,
        fogEnabled: input.fogEnabled ?? false,
        dmNotes: input.dmNotes ?? "",
        sortOrder: input.sortOrder ?? n,
      })
      .returning();
    // The first map of a campaign becomes the active one so players have somewhere to go.
    if (!m.campaign.activeSceneId) await this.setActive(m, row!.id);
    return row!;
  }

  private checkSize(width: number, height: number) {
    if (width < 100 || height < 100 || width > MAX_SCENE_PX || height > MAX_SCENE_PX) {
      throw badRequest(`Map size must be between 100 and ${MAX_SCENE_PX} pixels on each side`);
    }
  }

  async update(m: Membership, sceneId: string, patch: Partial<SceneInput> & { expectedVersion?: number }): Promise<SceneRow> {
    if (!m.caps.has("map.manage")) throw forbidden("Only the DM can edit maps");
    const current = await this.sceneRow(m.campaign.id, sceneId);
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== current.version) {
      throw conflict("This map was changed by someone else. Reload to see the latest version.", { version: current.version });
    }
    if (patch.backgroundAssetId) await this.assets.requireCampaignAsset(patch.backgroundAssetId, m.campaign.id, m.member.userId);
    if (patch.music) await this.checkMusic(m.campaign.id, patch.music);
    const width = patch.width ?? current.width;
    const height = patch.height ?? current.height;
    this.checkSize(width, height);
    const { expectedVersion: _ignored, grid, ...rest } = patch;
    const [row] = await this.db
      .update(scenes)
      .set({
        ...rest,
        ...(grid ? { grid: { ...current.grid, ...grid } } : {}),
        version: sql`${scenes.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(scenes.id, sceneId))
      .returning();
    return row!;
  }

  private async checkMusic(campaignId: string, music: SceneMusic) {
    const table = music.kind === "playlist" ? playlists : audioTracks;
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, music.id), eq(table.campaignId, campaignId)));
    if (!row) throw badRequest(music.kind === "playlist" ? "That playlist isn't in this campaign" : "That track isn't in this campaign");
  }

  async remove(m: Membership, sceneId: string): Promise<void> {
    if (!m.caps.has("map.manage")) throw forbidden("Only the DM can delete maps");
    await this.sceneRow(m.campaign.id, sceneId);
    await this.db.transaction(async (tx) => {
      await tx.update(scenes).set({ deletedAt: new Date() }).where(eq(scenes.id, sceneId));
      await tx
        .update(campaigns)
        .set({ activeSceneId: null })
        .where(and(eq(campaigns.id, m.campaign.id), eq(campaigns.activeSceneId, sceneId)));
    });
  }

  async duplicate(m: Membership, sceneId: string): Promise<SceneRow> {
    if (!m.caps.has("map.manage")) throw forbidden("Only the DM can copy maps");
    const src = await this.sceneRow(m.campaign.id, sceneId);
    return this.db.transaction(async (tx) => {
      const [copy] = await tx
        .insert(scenes)
        .values({
          campaignId: src.campaignId,
          name: `${src.name} (copy)`.slice(0, 100),
          backgroundAssetId: src.backgroundAssetId,
          backgroundColor: src.backgroundColor,
          width: src.width,
          height: src.height,
          grid: src.grid,
          fogEnabled: src.fogEnabled,
          dmNotes: src.dmNotes,
          music: src.music,
          vision: src.vision,
          sortOrder: src.sortOrder + 1,
        })
        .returning();
      const srcTokens = await tx.select().from(tokens).where(eq(tokens.sceneId, src.id));
      if (srcTokens.length) {
        await tx.insert(tokens).values(
          srcTokens.map(({ id: _id, createdAt: _c, updatedAt: _u, version: _v, ...t }) => ({ ...t, sceneId: copy!.id })),
        );
      }
      const srcFog = await tx.select().from(fogOps).where(eq(fogOps.sceneId, src.id)).orderBy(asc(fogOps.seq));
      for (const f of srcFog) await tx.insert(fogOps).values({ sceneId: copy!.id, mode: f.mode, shape: f.shape, createdBy: f.createdBy });
      const srcTemplates = await tx.select().from(mapTemplates).where(eq(mapTemplates.sceneId, src.id));
      if (srcTemplates.length) {
        await tx.insert(mapTemplates).values(srcTemplates.map(({ id: _id, createdAt: _c, updatedAt: _u, ...t }) => ({ ...t, sceneId: copy!.id })));
      }
      const srcWalls = await tx.select().from(mapWalls).where(eq(mapWalls.sceneId, src.id));
      if (srcWalls.length) {
        await tx.insert(mapWalls).values(srcWalls.map(({ id: _id, createdAt: _c, ...w }) => ({ ...w, sceneId: copy!.id })));
      }
      return copy!;
    });
  }

  async setActive(m: Membership, sceneId: string | null): Promise<void> {
    if (!m.caps.has("map.manage")) throw forbidden("Only the DM can change the map players see");
    if (sceneId) await this.sceneRow(m.campaign.id, sceneId);
    await this.db.update(campaigns).set({ activeSceneId: sceneId }).where(eq(campaigns.id, m.campaign.id));
    m.campaign.activeSceneId = sceneId;
  }

  // ---- Full state (per viewer) --------------------------------------------

  async fogState(sceneRow: SceneRow): Promise<{ state: FogState; ops: FogOpDto[] }> {
    const rows = await this.db
      .select({ id: fogOps.id, mode: fogOps.mode, shape: fogOps.shape })
      .from(fogOps)
      .where(eq(fogOps.sceneId, sceneRow.id))
      .orderBy(asc(fogOps.seq));
    return { state: { enabled: sceneRow.fogEnabled, ops: rows }, ops: rows };
  }

  async tokenRows(sceneId: string): Promise<Array<{ token: TokenRow; character: LinkedCharacter | null }>> {
    const rows = await this.db
      .select({ token: tokens, data: characters.data, kind: characters.kind, deletedAt: characters.deletedAt })
      .from(tokens)
      .leftJoin(characters, eq(characters.id, tokens.characterId))
      .where(eq(tokens.sceneId, sceneId))
      .orderBy(asc(tokens.createdAt));
    return rows.map((r) => ({ token: r.token, character: r.data && r.kind && !r.deletedAt ? { data: r.data, kind: r.kind } : null }));
  }

  /** One token as a DTO (with linked character vitals). */
  async tokenDto(tokenId: string): Promise<TokenDto | null> {
    const [r] = await this.db
      .select({ token: tokens, data: characters.data, kind: characters.kind, deletedAt: characters.deletedAt })
      .from(tokens)
      .leftJoin(characters, eq(characters.id, tokens.characterId))
      .where(eq(tokens.id, tokenId));
    if (!r) return null;
    return toTokenDto(r.token, r.data && r.kind && !r.deletedAt ? { data: r.data, kind: r.kind } : null);
  }

  /** Tokens (with scene) linked to a character, for re-broadcasting after sheet edits. */
  async tokenScenes(ids: string[]): Promise<Array<{ id: string; sceneId: string }>> {
    if (!ids.length) return [];
    return this.db.select({ id: tokens.id, sceneId: tokens.sceneId }).from(tokens).where(inArray(tokens.id, ids));
  }

  async tokensForCharacter(characterId: string): Promise<Array<{ id: string; sceneId: string; campaignId: string }>> {
    return this.db.select({ id: tokens.id, sceneId: tokens.sceneId, campaignId: tokens.campaignId }).from(tokens).where(eq(tokens.characterId, characterId));
  }

  /** Everything one viewer is allowed to know about a scene. */
  async stateFor(m: Membership, sceneId: string): Promise<SceneState> {
    const row = await this.viewable(m, sceneId);
    const [{ state, ops }, rows, templates, walls] = await Promise.all([this.fogState(row), this.tokenRows(row.id), this.templateRows(row.id), this.walls(row.id)]);
    const viewer = viewerOf(m);
    const all = rows.map((r) => toTokenDto(r.token, r.character));
    const sight = sightFor(row, walls, all, viewer);
    const visible = all.filter((t) => canSeeToken(t, viewer, state, sight)).map((t) => redactToken(t, viewer));
    return {
      scene: toSceneDto(row, m.campaign.activeSceneId, m.caps.has("dmNotes.view")),
      tokens: visible,
      fog: ops,
      templates: templates.filter((t) => !t.hidden || viewer.isGameMaster).map(toTemplateDto),
      walls: wallsFor(walls, viewer.isGameMaster),
    };
  }

  // ---- Walls & doors (dynamic vision) ----------------------------------------

  async walls(sceneId: string): Promise<Wall[]> {
    const rows = await this.db.select().from(mapWalls).where(eq(mapWalls.sceneId, sceneId)).orderBy(asc(mapWalls.createdAt));
    return rows.map(toWall);
  }

  private requireWalls(m: Membership) {
    if (!m.caps.has("map.manage")) throw forbidden("Only the DM can edit walls");
  }

  /** DM: adds one or more wall segments (a drawn chain). */
  async addWalls(m: Membership, sceneId: string, segs: Array<{ x1: number; y1: number; x2: number; y2: number }>, kind: WallKind): Promise<Wall[]> {
    this.requireWalls(m);
    await this.sceneRow(m.campaign.id, sceneId);
    const clean = segs.map(normalizeWall).filter((w): w is NonNullable<typeof w> => !!w);
    if (!clean.length) throw badRequest("Those walls are too short");
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(mapWalls).where(eq(mapWalls.sceneId, sceneId));
    if (n + clean.length > MAX_WALLS) throw badRequest(`A map can hold at most ${MAX_WALLS} walls`);
    const rows = await this.db
      .insert(mapWalls)
      .values(clean.map((w) => ({ ...w, kind, campaignId: m.campaign.id, sceneId })))
      .returning();
    return rows.map(toWall);
  }

  async updateWall(m: Membership, sceneId: string, wallId: string, patch: { kind?: WallKind; locked?: boolean; open?: boolean }): Promise<Wall> {
    this.requireWalls(m);
    const [row] = await this.db
      .update(mapWalls)
      .set(patch)
      .where(and(eq(mapWalls.id, wallId), eq(mapWalls.sceneId, sceneId), eq(mapWalls.campaignId, m.campaign.id)))
      .returning();
    if (!row) throw notFound("Wall");
    return toWall(row);
  }

  async deleteWalls(m: Membership, sceneId: string, wallIds: string[] | "all"): Promise<void> {
    this.requireWalls(m);
    await this.sceneRow(m.campaign.id, sceneId);
    const where = wallIds === "all" ? eq(mapWalls.sceneId, sceneId) : and(eq(mapWalls.sceneId, sceneId), inArray(mapWalls.id, wallIds));
    await this.db.delete(mapWalls).where(where);
  }

  /**
   * Opens or closes a door. The DM can use any door; players can use unlocked doors on
   * the map they're on that one of their tokens can see (secret doors look like walls to them).
   */
  async toggleDoor(m: Membership, sceneId: string, wallId: string): Promise<Wall> {
    const scene = await this.viewable(m, sceneId);
    const [row] = await this.db.select().from(mapWalls).where(and(eq(mapWalls.id, wallId), eq(mapWalls.sceneId, sceneId)));
    if (!row || row.kind === "wall") throw notFound("Door");
    const isGM = m.caps.has("map.manage");
    if (!isGM) {
      if (row.kind === "secret") throw notFound("Door");
      if (row.locked) throw forbidden("The door is locked");
      if (!m.caps.has("token.controlOwn")) throw forbidden("Your role can't open doors");
      if (scene.vision?.enabled) {
        const [rows, walls] = await Promise.all([this.tokenRows(sceneId), this.walls(sceneId)]);
        const sight = sightFor(scene, walls, rows.map((r) => toTokenDto(r.token, r.character)), viewerOf(m));
        const mid = { x: (row.x1 + row.x2) / 2, y: (row.y1 + row.y2) / 2 };
        // The door itself blocks the line to its middle, so test against the other walls.
        const others = { ...sight!, walls: sight!.walls.filter((w) => w.id !== row.id) };
        if (!others.eyes.some((e) => isPointVisibleFrom(others, e, mid))) throw forbidden("You can't see that door");
      }
    }
    const [after] = await this.db.update(mapWalls).set({ open: !row.open }).where(eq(mapWalls.id, wallId)).returning();
    return toWall(after!);
  }

  // ---- AoE templates -------------------------------------------------------

  templateRows(sceneId: string): Promise<MapTemplateRow[]> {
    return this.db.select().from(mapTemplates).where(eq(mapTemplates.sceneId, sceneId)).orderBy(asc(mapTemplates.createdAt));
  }

  /** Anyone who can move tokens may draw templates; only the DM makes hidden ones. */
  async createTemplate(m: Membership, sceneId: string, input: TemplateInput): Promise<MapTemplateRow> {
    if (!m.caps.has("token.controlOwn") && !m.caps.has("map.manage")) throw forbidden("Your role can't place templates");
    if (input.hidden && !m.caps.has("map.manage")) throw forbidden("Only the DM can hide templates");
    const scene = await this.viewable(m, sceneId);
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(mapTemplates).where(eq(mapTemplates.sceneId, scene.id));
    if (n >= MAX_TEMPLATES_PER_SCENE) throw badRequest(`At most ${MAX_TEMPLATES_PER_SCENE} templates per map. Clear some first.`);
    const [row] = await this.db
      .insert(mapTemplates)
      .values({ ...input, campaignId: m.campaign.id, sceneId: scene.id, ownerId: m.member.userId })
      .returning();
    return row!;
  }

  private async ownTemplate(m: Membership, sceneId: string, templateId: string): Promise<MapTemplateRow> {
    await this.viewable(m, sceneId);
    const [row] = await this.db
      .select()
      .from(mapTemplates)
      .where(and(eq(mapTemplates.id, templateId), eq(mapTemplates.sceneId, sceneId), eq(mapTemplates.campaignId, m.campaign.id)));
    if (!row || (row.hidden && !m.caps.has("map.manage"))) throw notFound("Template");
    if (row.ownerId !== m.member.userId && !m.caps.has("map.manage")) throw forbidden("You can only change your own templates");
    return row;
  }

  async updateTemplate(m: Membership, sceneId: string, templateId: string, patch: Partial<TemplateInput>): Promise<{ before: MapTemplateRow; after: MapTemplateRow }> {
    const before = await this.ownTemplate(m, sceneId, templateId);
    if (patch.hidden !== undefined && !m.caps.has("map.manage")) throw forbidden("Only the DM can hide templates");
    const [after] = await this.db.update(mapTemplates).set({ ...patch, updatedAt: new Date() }).where(eq(mapTemplates.id, templateId)).returning();
    return { before, after: after! };
  }

  async deleteTemplate(m: Membership, sceneId: string, templateId: string): Promise<MapTemplateRow> {
    const row = await this.ownTemplate(m, sceneId, templateId);
    await this.db.delete(mapTemplates).where(eq(mapTemplates.id, templateId));
    return row;
  }

  /** DM: remove every template on the map. */
  async clearTemplates(m: Membership, sceneId: string): Promise<void> {
    if (!m.caps.has("map.manage")) throw forbidden("Only the DM can clear all templates");
    await this.viewable(m, sceneId);
    await this.db.delete(mapTemplates).where(eq(mapTemplates.sceneId, sceneId));
  }

  // ---- Tokens ------------------------------------------------------------

  private async tokenRow(sceneId: string, tokenId: string): Promise<TokenRow> {
    const [row] = await this.db.select().from(tokens).where(and(eq(tokens.id, tokenId), eq(tokens.sceneId, sceneId))).limit(1);
    if (!row) throw notFound("Token");
    return row;
  }

  private async validateRefs(m: Membership, input: Partial<TokenInput>) {
    if (input.imageAssetId) await this.assets.requireCampaignAsset(input.imageAssetId, m.campaign.id, m.member.userId);
    if (input.characterId) {
      const [c] = await this.db
        .select({ id: characters.id, ownerId: characters.ownerId, campaignId: characters.campaignId })
        .from(characters)
        .where(and(eq(characters.id, input.characterId), isNull(characters.deletedAt)));
      if (!c) throw badRequest("Linked character not found");
      // Campaign NPCs/monsters, or a PC that a member has selected for this campaign.
      if (c.campaignId !== m.campaign.id) {
        const roles = await this.campaigns.memberRoles(m.campaign.id);
        if (!roles.has(c.ownerId)) throw badRequest("That character isn't part of this campaign");
        if (!m.caps.has("token.manageAll") && c.ownerId !== m.member.userId) throw forbidden("You can only place your own character");
      }
    }
    if (input.ownerIds?.length) {
      const found = await this.campaigns.membersByIds(m.campaign.id, input.ownerIds);
      if (found.length !== new Set(input.ownerIds).size) throw badRequest("Token owners must be campaign members");
    }
  }

  async createToken(m: Membership, sceneId: string, input: Partial<TokenInput> & { x: number; y: number }): Promise<TokenDto> {
    const scene = await this.viewable(m, sceneId);
    const isGM = m.caps.has("token.manageAll");
    if (!isGM) {
      // Players may place a token for their own character only; they own it and can't hide it.
      if (!m.caps.has("token.controlOwn") || !input.characterId) throw forbidden("Only the DM can add tokens");
      input = { characterId: input.characterId, x: input.x, y: input.y, size: input.size, ownerIds: [m.member.userId] };
    }
    await this.validateRefs(m, input);
    if (input.characterId) {
      const [dup] = await this.db
        .select({ id: tokens.id })
        .from(tokens)
        .where(and(eq(tokens.sceneId, sceneId), eq(tokens.characterId, input.characterId)))
        .limit(1);
      if (dup && !isGM) throw conflict("Your character is already on this map");
    }
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tokens)
      .where(eq(tokens.sceneId, sceneId))) as [{ n: number }];
    if (n >= MAX_TOKENS_PER_SCENE) throw badRequest(`A map can hold at most ${MAX_TOKENS_PER_SCENE} tokens`);

    let name = input.name;
    let color = input.color;
    let linked: LinkedCharacter | null = null;
    if (input.characterId) {
      const [c] = await this.db
        .select({ name: characters.name, data: characters.data, kind: characters.kind })
        .from(characters)
        .where(eq(characters.id, input.characterId));
      name ||= c?.name;
      color ||= c?.data.color;
      if (c) linked = { data: c.data, kind: c.kind };
    }
    // Party members' HP is public by default; monsters/NPCs stay GM-only unless the DM opens them up.
    const hpVis: HpVisibility = input.hpVisibility ?? (linked?.kind === "pc" ? "everyone" : "gm");
    const [row] = await this.db
      .insert(tokens)
      .values({
        sceneId,
        campaignId: scene.campaignId,
        characterId: input.characterId ?? null,
        name: name || "Token",
        imageAssetId: input.imageAssetId ?? null,
        x: clampCoord(input.x, scene.width),
        y: clampCoord(input.y, scene.height),
        size: input.size ?? 1,
        rotation: input.rotation ?? 0,
        layer: input.layer ?? "tokens",
        shape: input.shape ?? "circle",
        ...(color ? { color } : {}),
        ...(input.borderColor ? { borderColor: input.borderColor } : {}),
        hidden: input.hidden ?? false,
        locked: input.locked ?? false,
        showName: input.showName ?? true,
        ownerIds: [...new Set(input.ownerIds ?? [])],
        hpVisibility: hpVis,
        stats: input.stats ?? null,
        sight: input.sight ?? null,
        light: input.light ?? null,
      })
      .returning();
    return redactToken(toTokenDto(row!, linked), viewerOf(m));
  }

  /**
   * Applies a token patch. Last write wins on the server; `version` lets clients
   * drop stale broadcasts. Owners may only move/rotate their unlocked tokens.
   */
  async updateToken(m: Membership, sceneId: string, tokenId: string, patch: Partial<TokenInput>): Promise<TokenDto> {
    const scene = await this.viewable(m, sceneId);
    const current = await this.tokenRow(sceneId, tokenId);
    const viewer = viewerOf(m);
    const currentDto = toTokenDto(current);
    if (!canControlToken(currentDto, viewer)) throw forbidden("You can't move that token");
    if (!viewer.isGameMaster) {
      const allowed = new Set<string>(OWNER_EDITABLE_FIELDS);
      for (const k of Object.keys(patch)) if (!allowed.has(k)) throw forbidden(`Only the DM can change '${k}'`);
    }
    await this.validateRefs(m, patch);
    const values: Partial<typeof tokens.$inferInsert> = { ...patch };
    if (patch.x !== undefined) values.x = clampCoord(patch.x, scene.width);
    if (patch.y !== undefined) values.y = clampCoord(patch.y, scene.height);
    if (patch.ownerIds) values.ownerIds = [...new Set(patch.ownerIds)];
    // Editing AC/HP sends stats without the stat block link; keep the link unless it is set explicitly.
    if (patch.stats && patch.stats.statBlock === undefined && current.stats?.statBlock) {
      values.stats = { ...patch.stats, statBlock: current.stats.statBlock };
    }
    const [row] = await this.db
      .update(tokens)
      .set({ ...values, version: sql`${tokens.version} + 1`, updatedAt: new Date() })
      .where(eq(tokens.id, tokenId))
      .returning();
    return redactToken((await this.tokenDto(row!.id))!, viewer);
  }

  async deleteToken(m: Membership, sceneId: string, tokenId: string): Promise<TokenDto> {
    await this.viewable(m, sceneId);
    const current = await this.tokenRow(sceneId, tokenId);
    if (!m.caps.has("token.manageAll")) throw forbidden("Only the DM can remove tokens");
    await this.db.delete(tokens).where(eq(tokens.id, tokenId));
    return toTokenDto(current);
  }

  // ---- Fog -------------------------------------------------------------------

  private requireFog(m: Membership) {
    if (!m.caps.has("fog.manage")) throw forbidden("Only the DM can change the fog of war");
  }

  async addFog(m: Membership, sceneId: string, mode: "reveal" | "hide", shape: FogShape): Promise<FogOpDto> {
    this.requireFog(m);
    await this.sceneRow(m.campaign.id, sceneId);
    const clean = normalizeShape(shape);
    if (!clean) throw badRequest("That shape is too small or invalid");
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(fogOps)
      .where(eq(fogOps.sceneId, sceneId))) as [{ n: number }];
    if (n >= MAX_FOG_OPS) throw badRequest("Too many fog shapes on this map. Use 'Hide all' or 'Reveal all' to start fresh.");
    const [row] = await this.db.insert(fogOps).values({ sceneId, mode, shape: clean, createdBy: m.member.userId }).returning();
    return { id: row!.id, mode: row!.mode, shape: row!.shape };
  }

  /** Resets fog: "hide" covers the whole map, "reveal" uncovers it. Both clear the shape history. */
  async resetFog(m: Membership, sceneId: string, mode: "reveal" | "hide"): Promise<void> {
    this.requireFog(m);
    const scene = await this.sceneRow(m.campaign.id, sceneId);
    await this.db.transaction(async (tx) => {
      await tx.delete(fogOps).where(eq(fogOps.sceneId, sceneId));
      if (mode === "reveal") {
        await tx.insert(fogOps).values({
          sceneId,
          mode: "reveal",
          shape: { kind: "rect", x: 0, y: 0, width: scene.width, height: scene.height },
          createdBy: m.member.userId,
        });
      }
    });
  }

  /** Removes the most recent fog shape (DM undo for fog). */
  async undoFog(m: Membership, sceneId: string): Promise<boolean> {
    this.requireFog(m);
    await this.sceneRow(m.campaign.id, sceneId);
    const [last] = await this.db
      .select({ id: fogOps.id })
      .from(fogOps)
      .where(eq(fogOps.sceneId, sceneId))
      .orderBy(desc(fogOps.seq))
      .limit(1);
    if (!last) return false;
    await this.db.delete(fogOps).where(eq(fogOps.id, last.id));
    return true;
  }

  async setFogEnabled(m: Membership, sceneId: string, enabled: boolean): Promise<SceneRow> {
    this.requireFog(m);
    await this.sceneRow(m.campaign.id, sceneId);
    const [row] = await this.db
      .update(scenes)
      .set({ fogEnabled: enabled, version: sql`${scenes.version} + 1`, updatedAt: new Date() })
      .where(eq(scenes.id, sceneId))
      .returning();
    return row!;
  }
}

function isPointVisibleFrom(s: ViewerSight, eye: ViewerSight["eyes"][number], p: { x: number; y: number }): boolean {
  return isPointVisible({ ...s, eyes: [eye] }, p);
}

/** Keeps tokens within (a margin around) the scene so they can't be lost off-map. */
function clampCoord(v: number, max: number): number {
  if (!Number.isFinite(v)) throw badRequest("Invalid position");
  return Math.min(Math.max(v, 0), max);
}
