import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/routes.js";
import { cleanText, parse } from "../lib/validation.js";

const campaignParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const version = z.number().int().min(1);

const journalFields = z.object({
  title: cleanText(120).pipe(z.string().min(1, "Title is required")),
  body: z.string().max(100_000),
  folder: cleanText(60),
  visibility: z.enum(["gm", "all", "selected", "author"]),
  sharedWith: z.array(z.uuid()).max(50),
  imageAssetId: z.uuid().nullable(),
  pinned: z.boolean(),
});

const encounterEntry = z.object({
  ref: z.object({ type: z.enum(["srd", "character"]), id: cleanText(80).pipe(z.string().min(1)) }),
  name: cleanText(80).pipe(z.string().min(1)),
  count: z.number().int().min(1).max(50),
  xp: z.number().int().min(0).max(1_000_000),
});
const encounterFields = z.object({
  name: cleanText(80).pipe(z.string().min(1, "Name is required")),
  notes: z.string().max(20_000),
  entries: z.array(encounterEntry).max(40),
});

const tableEntry = z.object({ min: z.number().int().min(-1000).max(100_000), max: z.number().int().min(-1000).max(100_000), text: cleanText(500).pipe(z.string().min(1)) });
const tableFields = z.object({
  name: cleanText(80).pipe(z.string().min(1, "Name is required")),
  formula: cleanText(20).pipe(z.string().min(1)),
  entries: z.array(tableEntry).max(200),
});

/** Journal & handouts, encounters, random tables (Phase 5 DM toolkit). */
export async function dmToolRoutes(app: FastifyInstance) {
  const { campaigns, dmTools } = app.ctx;
  const member = async (req: Parameters<typeof requireAuth>[0], campaignId: string) => campaigns.membership(campaignId, requireAuth(req).user.id);

  // ---- Journal ----
  app.get("/api/campaigns/:id/journal", async (req) => {
    const { id } = parse(campaignParams, req.params);
    return { entries: await dmTools.listJournal(await member(req, id)) };
  });

  app.get("/api/campaigns/:id/journal/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    return { entry: await dmTools.getJournal(await member(req, id), itemId) };
  });

  app.post("/api/campaigns/:id/journal", { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const { id } = parse(campaignParams, req.params);
    const m = await member(req, id);
    const body = parse(
      journalFields.partial({ body: true, folder: true, sharedWith: true, imageAssetId: true, pinned: true }).extend({
        visibility: journalFields.shape.visibility.default(m.caps.has("journal.manage") ? "gm" : "author"),
      }),
      req.body,
    );
    const row = await dmTools.createJournal(m, { body: "", folder: "", sharedWith: [], imageAssetId: null, pinned: false, ...body });
    app.ctx.realtime?.journalChanged(id, null, row);
    return reply.code(201).send({ entry: await dmTools.getJournal(m, row.id) });
  });

  app.put("/api/campaigns/:id/journal/:itemId", { bodyLimit: 256 * 1024 }, async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const m = await member(req, id);
    const { expectedVersion, ...patch } = parse(journalFields.partial().extend({ expectedVersion: version }), req.body);
    const { before, after } = await dmTools.updateJournal(m, itemId, expectedVersion, patch);
    app.ctx.realtime?.journalChanged(id, before, after);
    return { entry: await dmTools.getJournal(m, itemId) };
  });

  app.delete("/api/campaigns/:id/journal/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const row = await dmTools.deleteJournal(await member(req, id), itemId);
    app.ctx.realtime?.journalChanged(id, row, null);
    return { ok: true };
  });

  app.post("/api/campaigns/:id/journal/:itemId/show", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const m = await member(req, id);
    const { to } = parse(z.object({ to: z.union([z.literal("all"), z.array(z.uuid()).min(1).max(50)]) }), req.body);
    const { before, after, recipients } = await dmTools.showHandout(m, itemId, to);
    app.ctx.realtime?.journalChanged(id, before, after);
    app.ctx.realtime?.handoutShown(id, after, recipients, m.member.userId);
    return { entry: await dmTools.getJournal(m, itemId) };
  });

  // ---- Encounters ----
  app.get("/api/campaigns/:id/encounters", async (req) => {
    const { id } = parse(campaignParams, req.params);
    return { encounters: await dmTools.listEncounters(await member(req, id)) };
  });

  app.post("/api/campaigns/:id/encounters", async (req, reply) => {
    const { id } = parse(campaignParams, req.params);
    const body = parse(encounterFields.partial({ notes: true }), req.body);
    return reply.code(201).send({ encounter: await dmTools.createEncounter(await member(req, id), { notes: "", ...body }) });
  });

  app.put("/api/campaigns/:id/encounters/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const { expectedVersion, ...patch } = parse(encounterFields.partial().extend({ expectedVersion: version }), req.body);
    return { encounter: await dmTools.updateEncounter(await member(req, id), itemId, expectedVersion, patch) };
  });

  app.delete("/api/campaigns/:id/encounters/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    await dmTools.deleteEncounter(await member(req, id), itemId);
    return { ok: true };
  });

  // ---- Random tables ----
  app.get("/api/campaigns/:id/tables", async (req) => {
    const { id } = parse(campaignParams, req.params);
    return { tables: await dmTools.listTables(await member(req, id)) };
  });

  app.post("/api/campaigns/:id/tables", async (req, reply) => {
    const { id } = parse(campaignParams, req.params);
    return reply.code(201).send({ table: await dmTools.createTable(await member(req, id), parse(tableFields, req.body)) });
  });

  app.put("/api/campaigns/:id/tables/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const { expectedVersion, ...patch } = parse(tableFields.partial().extend({ expectedVersion: version }), req.body);
    return { table: await dmTools.updateTable(await member(req, id), itemId, expectedVersion, patch) };
  });

  app.delete("/api/campaigns/:id/tables/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    await dmTools.deleteTable(await member(req, id), itemId);
    return { ok: true };
  });

  app.post("/api/campaigns/:id/tables/:itemId/roll", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const { visibility } = parse(z.object({ visibility: z.enum(["dm_only", "public"]).default("dm_only") }), req.body ?? {});
    return dmTools.rollTable(await member(req, id), itemId, visibility);
  });
}
