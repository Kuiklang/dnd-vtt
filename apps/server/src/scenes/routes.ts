import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AMBIENT_LIGHTS, GRID_TYPES, HP_VISIBILITY, MAX_SIGHT_FT, TOKEN_LAYERS, TOKEN_SHAPES } from "@vtt/rules";
import { requireAuth } from "../auth/routes.js";
import { cleanText, parse } from "../lib/validation.js";
import { toSceneDto } from "./service.js";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");

export const gridSchema = z.object({
  type: z.enum(GRID_TYPES),
  size: z.number().min(10).max(500),
  offsetX: z.number().min(-500).max(500),
  offsetY: z.number().min(-500).max(500),
  color: hexColor,
  opacity: z.number().min(0).max(1),
  unitsPerCell: z.number().min(0.1).max(10000),
  unit: cleanText(12).pipe(z.string().min(1)),
});

const sceneFields = {
  name: cleanText(100).pipe(z.string().min(1, "Name is required")),
  backgroundAssetId: z.uuid().nullable(),
  backgroundColor: hexColor,
  width: z.number().int(),
  height: z.number().int(),
  grid: gridSchema.partial(),
  fogEnabled: z.boolean(),
  dmNotes: cleanText(20000),
  music: z.object({ kind: z.enum(["playlist", "track"]), id: z.uuid() }).nullable(),
  sortOrder: z.number().int().min(0).max(10000),
  vision: z.object({ enabled: z.boolean(), ambient: z.enum(AMBIENT_LIGHTS) }),
};

export const sceneCreateSchema = z.object({ ...sceneFields }).partial().required({ name: true });
export const sceneUpdateSchema = z.object({ ...sceneFields, expectedVersion: z.number().int().min(1) }).partial();

const coord = z.number().min(-1e6).max(1e6);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const damageTypes = z.array(cleanText(30).pipe(z.string().min(1))).max(20);
export const defensesSchema = z.object({ resistances: damageTypes, vulnerabilities: damageTypes, immunities: damageTypes });
export const tokenConditionSchema = z.object({
  id: cleanText(40).pipe(z.string().min(1)),
  level: int(1, 20).optional(),
  source: cleanText(80).optional(),
  durationRounds: int(0, 100000).nullable(),
});
export const tokenStatsSchema = z.object({
  hp: z.object({ current: int(-10000, 10000), max: int(0, 10000), temp: int(0, 10000) }),
  ac: int(0, 50).nullable(),
  initiativeBonus: int(-20, 50),
  conditions: z.array(tokenConditionSchema).max(30),
  defenses: defensesSchema,
  statBlock: z.object({ type: z.enum(["srd", "character"]), id: cleanText(80).pipe(z.string().min(1)) }).nullable().optional(),
});
export const tokenFields = z.object({
  characterId: z.uuid().nullable(),
  name: cleanText(60),
  imageAssetId: z.uuid().nullable(),
  x: coord,
  y: coord,
  size: z.number().min(0.25).max(10),
  rotation: z.number().min(-360).max(360),
  layer: z.enum(TOKEN_LAYERS),
  shape: z.enum(TOKEN_SHAPES),
  color: hexColor,
  borderColor: hexColor,
  hidden: z.boolean(),
  locked: z.boolean(),
  showName: z.boolean(),
  ownerIds: z.array(z.uuid()).max(20),
  hpVisibility: z.enum(HP_VISIBILITY),
  stats: tokenStatsSchema.nullable(),
  sight: z.object({ darkvision: z.number().min(0).max(MAX_SIGHT_FT) }).nullable(),
  light: z.object({ bright: z.number().min(0).max(MAX_SIGHT_FT), dim: z.number().min(0).max(MAX_SIGHT_FT), color: hexColor }).nullable(),
});

const params = z.object({ id: z.uuid(), sceneId: z.uuid() });

export async function sceneRoutes(app: FastifyInstance) {
  const { campaigns, scenes } = app.ctx;
  const changed = (campaignId: string) => app.ctx.realtime?.scenesChanged(campaignId);

  app.get("/api/campaigns/:id/scenes", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const m = await campaigns.membership(id, user.id);
    return { scenes: await scenes.list(m), activeSceneId: m.caps.has("map.manage") ? m.campaign.activeSceneId : undefined };
  });

  app.post("/api/campaigns/:id/scenes", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(sceneCreateSchema, req.body);
    const m = await campaigns.membership(id, user.id);
    const wasActive = m.campaign.activeSceneId;
    const row = await scenes.create(m, body);
    changed(id);
    if (!wasActive && m.campaign.activeSceneId) await app.ctx.realtime?.sceneActivated(id, wasActive, m.campaign.activeSceneId);
    return reply.code(201).send({ scene: toSceneDto(row, m.campaign.activeSceneId, true) });
  });

  app.patch("/api/campaigns/:id/scenes/:sceneId", async (req) => {
    const { user } = requireAuth(req);
    const { id, sceneId } = parse(params, req.params);
    const body = parse(sceneUpdateSchema, req.body);
    const m = await campaigns.membership(id, user.id);
    const row = await scenes.update(m, sceneId, body);
    changed(id);
    await app.ctx.realtime?.sendSceneState(id, sceneId);
    return { scene: toSceneDto(row, m.campaign.activeSceneId, true) };
  });

  app.post("/api/campaigns/:id/scenes/:sceneId/duplicate", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id, sceneId } = parse(params, req.params);
    const m = await campaigns.membership(id, user.id);
    const row = await scenes.duplicate(m, sceneId);
    changed(id);
    return reply.code(201).send({ scene: toSceneDto(row, m.campaign.activeSceneId, true) });
  });

  app.delete("/api/campaigns/:id/scenes/:sceneId", async (req) => {
    const { user } = requireAuth(req);
    const { id, sceneId } = parse(params, req.params);
    const m = await campaigns.membership(id, user.id);
    await scenes.remove(m, sceneId);
    changed(id);
    await app.ctx.realtime?.sceneDeleted(id, sceneId);
    return { ok: true };
  });

  /** Sets the scene every player is shown ("pull players to this map"). */
  app.post("/api/campaigns/:id/active-scene", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const { sceneId } = parse(z.object({ sceneId: z.uuid().nullable() }), req.body);
    const m = await campaigns.membership(id, user.id);
    const previous = m.campaign.activeSceneId;
    await scenes.setActive(m, sceneId);
    changed(id);
    await app.ctx.realtime?.sceneActivated(id, previous, sceneId);
    // Scene music: switch the table's music when the DM shows a scene that has some.
    if (sceneId && sceneId !== previous && m.caps.has("music.control")) {
      const music = (await scenes.viewableRaw(id, sceneId))?.music;
      if (music) {
        const snap = await app.ctx.audio.startSceneMusic(m, music);
        if (snap) await app.ctx.realtime?.audioChanged(id, snap);
      }
    }
    return { activeSceneId: sceneId };
  });
}
