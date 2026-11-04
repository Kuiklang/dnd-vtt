import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/routes.js";
import { cleanText, parse } from "../lib/validation.js";

const campaignParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

const eventFields = z.object({
  title: cleanText(120).pipe(z.string().min(1, "Title is required")),
  body: z.string().max(20_000),
  inWorldDate: cleanText(80),
  sessionId: z.uuid().nullable(),
  visibility: z.enum(["players", "dm"]),
  sortKey: z.number().int().min(-1_000_000).max(1_000_000),
});

/** Session recaps and the campaign timeline (Phase 7). */
export async function timelineRoutes(app: FastifyInstance) {
  const { campaigns, timeline } = app.ctx;
  const member = (req: Parameters<typeof requireAuth>[0], campaignId: string) => campaigns.membership(campaignId, requireAuth(req).user.id);
  const changed = (id: string) => app.ctx.realtime?.campaignChanged(id, "timeline");

  app.get("/api/campaigns/:id/timeline", async (req) => {
    const { id } = parse(campaignParams, req.params);
    return timeline.timeline(await member(req, id));
  });

  app.get("/api/campaigns/:id/sessions/:itemId/recap-draft", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    return { draft: await timeline.recapDraft(await member(req, id), itemId) };
  });

  app.patch("/api/campaigns/:id/sessions/:itemId", { bodyLimit: 128 * 1024 }, async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const body = parse(z.object({ recap: z.string().max(50_000), recapPublished: z.boolean() }).partial(), req.body ?? {});
    const session = await timeline.updateRecap(await member(req, id), itemId, body);
    changed(id);
    return { session };
  });

  app.post("/api/campaigns/:id/timeline-events", async (req, reply) => {
    const { id } = parse(campaignParams, req.params);
    const body = parse(eventFields.partial().required({ title: true }), req.body ?? {});
    const event = await timeline.createEvent(await member(req, id), body);
    changed(id);
    return reply.code(201).send({ event });
  });

  app.patch("/api/campaigns/:id/timeline-events/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const body = parse(eventFields.partial(), req.body ?? {});
    const event = await timeline.updateEvent(await member(req, id), itemId, body);
    changed(id);
    return { event };
  });

  app.delete("/api/campaigns/:id/timeline-events/:itemId", async (req, reply) => {
    const { id, itemId } = parse(itemParams, req.params);
    await timeline.deleteEvent(await member(req, id), itemId);
    changed(id);
    return reply.code(204).send();
  });
}
