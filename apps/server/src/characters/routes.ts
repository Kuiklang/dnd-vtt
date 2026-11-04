import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characterKindSchema } from "@vtt/rules";
import { requireAuth } from "../auth/routes.js";
import { cleanText, idParams, parse } from "../lib/validation.js";

const name = cleanText(100).pipe(z.string().min(1, "Name is required"));

export async function characterRoutes(app: FastifyInstance) {
  const { characters } = app.ctx;
  const notify = (campaignIds: string[], characterId: string) => {
    for (const id of campaignIds) app.ctx.realtime?.characterChanged(id, characterId);
  };

  app.get("/api/characters", async (req) => {
    const { user } = requireAuth(req);
    return { characters: await characters.listLibrary(user.id) };
  });

  app.post("/api/characters", async (req, reply) => {
    const { user } = requireAuth(req);
    const body = parse(
      z.object({
        name,
        kind: characterKindSchema.default("pc"),
        rulesetId: z.string().max(80),
        data: z.unknown().optional(),
        campaignId: z.uuid().nullable().optional(),
        playerVisible: z.boolean().optional(),
      }),
      req.body,
    );
    const character = await characters.create(user, body);
    if (character.campaignId) notify([character.campaignId], character.id);
    return reply.code(201).send({ character });
  });

  app.post("/api/characters/import", { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const { user } = requireAuth(req);
    const body = parse(z.object({ file: z.unknown(), campaignId: z.uuid().nullable().optional() }), req.body);
    const character = await characters.import(user, body.file, body.campaignId);
    return reply.code(201).send({ character });
  });

  app.get("/api/characters/:id", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    return { character: await characters.get(id, user.id) };
  });

  app.put("/api/characters/:id", { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        expectedVersion: z.number().int().min(1),
        name: name.optional(),
        data: z.unknown().optional(),
        rulesetId: z.string().max(80).optional(),
        playerVisible: z.boolean().optional(),
      }),
      req.body,
    );
    const { character, affectedCampaigns } = await characters.update(id, user.id, body);
    notify(affectedCampaigns, id);
    return { character };
  });

  app.delete("/api/characters/:id", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const affected = await characters.remove(id, user.id);
    for (const cid of affected) app.ctx.realtime?.campaignChanged(cid, "members");
    return { ok: true };
  });

  app.post("/api/characters/:id/duplicate", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    return reply.code(201).send({ character: await characters.duplicate(id, user) });
  });

  app.get("/api/characters/:id/export", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const data = await characters.export(id, user.id);
    const filename = `${data.character.name.replace(/[^a-zA-Z0-9_-]+/g, "_") || "character"}.json`;
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    return data;
  });

  app.get("/api/campaigns/:id/characters", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    return { characters: await characters.listCampaignCharacters(id, user.id) };
  });
}
