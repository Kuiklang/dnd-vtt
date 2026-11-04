import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CHAT_CHANNELS, ROLL_VISIBILITIES } from "@vtt/rules";
import { requireAuth } from "../auth/routes.js";
import { cleanText, idParams, parse } from "../lib/validation.js";

const historyQuery = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** REST mirror of the realtime chat/dice events (history paging + non-socket clients). */
export async function chatRoutes(app: FastifyInstance) {
  const { campaigns, chat } = app.ctx;

  app.get("/api/campaigns/:id/chat", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const q = parse(historyQuery, req.query);
    const m = await campaigns.membership(id, user.id);
    return { messages: await chat.history(m, { before: q.before ? new Date(q.before) : undefined, limit: q.limit }) };
  });

  app.post("/api/campaigns/:id/chat", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        channel: z.enum(CHAT_CHANNELS).exclude(["system"]),
        content: cleanText(2000),
        recipientIds: z.array(z.uuid()).max(20).default([]),
        characterId: z.uuid().nullable().optional(),
      }),
      req.body,
    );
    const message = await chat.send(await campaigns.membership(id, user.id), body);
    return reply.code(201).send({ message });
  });

  app.get("/api/campaigns/:id/rolls", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const q = parse(historyQuery, req.query);
    const m = await campaigns.membership(id, user.id);
    return { rolls: await chat.rollHistory(m, { before: q.before ? new Date(q.before) : undefined, limit: q.limit }) };
  });

  app.post("/api/campaigns/:id/rolls", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        formula: z.string().max(200),
        mode: z.enum(["normal", "advantage", "disadvantage"]).default("normal"),
        visibility: z.enum(ROLL_VISIBILITIES).default("public"),
        recipientIds: z.array(z.uuid()).max(20).default([]),
        label: cleanText(80).default(""),
        rollType: z.enum(["custom", "check", "save", "skill", "attack", "damage", "initiative", "healing"]).default("custom"),
        characterId: z.uuid().nullable().optional(),
      }),
      req.body,
    );
    const roll = await chat.roll(await campaigns.membership(id, user.id), body);
    return reply.code(201).send({ roll });
  });
}
