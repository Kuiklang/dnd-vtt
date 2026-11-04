import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/routes.js";
import { parse } from "../lib/validation.js";

const charParams = z.object({ id: z.uuid(), charId: z.uuid() });

/** Spell casting and item hand-offs (Phase 7). */
export async function characterActionRoutes(app: FastifyInstance) {
  const { campaigns, actions, chat } = app.ctx;

  app.post("/api/campaigns/:id/characters/:charId/cast", async (req) => {
    const { user } = requireAuth(req);
    const { id, charId } = parse(charParams, req.params);
    const body = parse(
      z.object({
        spellId: z.string().min(1).max(40),
        slotLevel: z.number().int().min(0).max(9).default(0),
        ritual: z.boolean().default(false),
        visibility: z.enum(["public", "dm_only"]).default("public"),
      }),
      req.body,
    );
    const m = await campaigns.membership(id, user.id);
    const result = await actions.cast(m, charId, body);
    if (result.changed) app.ctx.realtime?.characterChanged(id, charId);
    return result;
  });

  app.get("/api/campaigns/:id/give-targets", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    return { characters: await actions.recipients(await campaigns.membership(id, user.id)) };
  });

  app.post("/api/campaigns/:id/characters/:charId/concentration/end", async (req) => {
    const { user } = requireAuth(req);
    const { id, charId } = parse(charParams, req.params);
    const r = await actions.endConcentration(await campaigns.membership(id, user.id), charId);
    if (r) {
      await chat.system(id, `${r.name} stops concentrating on ${r.spell}`);
      app.ctx.realtime?.characterChanged(id, r.id);
    }
    return { ended: r?.spell ?? null };
  });

  app.post("/api/campaigns/:id/characters/:charId/give", async (req) => {
    const { user } = requireAuth(req);
    const { id, charId } = parse(charParams, req.params);
    const body = parse(
      z.object({ itemId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(100000), toCharacterId: z.uuid() }),
      req.body,
    );
    const m = await campaigns.membership(id, user.id);
    const r = await actions.give(m, charId, body);
    await chat.system(id, `${r.from.name} gave ${r.quantity > 1 ? `${r.quantity}× ` : ""}${r.item} to ${r.to.name}`);
    app.ctx.realtime?.characterChanged(id, r.from.id);
    app.ctx.realtime?.characterChanged(id, r.to.id);
    return r;
  });
}
