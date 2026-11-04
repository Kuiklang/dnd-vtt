import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/routes.js";
import { cleanText, parse } from "../lib/validation.js";
import { ASSIST_MODES, AssistantService, type TextModel } from "./assistant.js";

const idParam = z.object({ id: z.uuid() });
const assistBody = z.object({
  mode: z.enum(ASSIST_MODES).default("ask"),
  prompt: cleanText(2000),
  language: z.enum(["th", "en"]).default("en"),
});

/** DM's AI assistant: status and one request/answer. Nothing is stored. */
export async function aiRoutes(app: FastifyInstance, opts: { model: TextModel | null }) {
  const assistant = new AssistantService(app.ctx, opts.model, app.ctx.config.AI_PER_HOUR);

  app.get("/api/campaigns/:id/ai", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParam, req.params);
    const m = await app.ctx.campaigns.membership(id, user.id);
    const isDm = m.caps.has("dmNotes.view");
    return { available: isDm && assistant.available, provider: isDm ? assistant.provider : null };
  });

  app.post("/api/campaigns/:id/ai/assist", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParam, req.params);
    const body = parse(assistBody, req.body);
    const m = await app.ctx.campaigns.membership(id, user.id);
    const res = await assistant.assist(m, body);
    req.log.info({ userId: user.id, mode: body.mode, provider: res.provider }, "ai assist");
    return res;
  });
}
