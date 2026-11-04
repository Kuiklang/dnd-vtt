import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BUILTIN_RULESETS, CAMPAIGN_ROLES } from "@vtt/rules";
import { requireAuth } from "../auth/routes.js";
import { cleanText, httpsUrl, idParams, parse } from "../lib/validation.js";
import { forbidden } from "../lib/errors.js";

const campaignBody = z.object({
  name: cleanText(80).pipe(z.string().min(1, "Campaign name is required")),
  description: cleanText(4000).default(""),
  coverImageUrl: z.union([httpsUrl, z.literal(""), z.null()]).default(null).transform((v) => v || null),
  rulesetId: z.string().max(80),
  setting: cleanText(120).default(""),
  theme: z.enum(["dark-fantasy", "high-fantasy", "horror", "sci-fantasy", "custom"]).default("dark-fantasy"),
  maxPlayers: z.number().int().min(1).max(20).default(6),
  privacy: z.enum(["public", "invite_only", "private"]).default("invite_only"),
  password: z.union([z.string().min(4, "Password must be at least 4 characters").max(100), z.literal(""), z.null()]).optional(),
  houseRules: cleanText(10000).default(""),
  permissions: z.unknown().optional(),
});

const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });
const codeParams = z.object({ code: z.string().regex(/^[A-Za-z0-9]{4,16}$/) });

export async function campaignRoutes(app: FastifyInstance) {
  const { campaigns, chat } = app.ctx;
  const changed = (id: string, reason: string) => app.ctx.realtime?.campaignChanged(id, reason);

  app.get("/api/rulesets", async () => ({
    rulesets: BUILTIN_RULESETS.map((r) => ({ id: r.id, name: r.name, version: r.version, attribution: r.attribution })),
  }));

  app.get("/api/campaigns", async (req) => {
    const { user } = requireAuth(req);
    return { campaigns: await campaigns.listForUser(user.id) };
  });

  app.get("/api/campaigns/public", async (req) => {
    const { user } = requireAuth(req);
    return { campaigns: await campaigns.listPublic(user.id) };
  });

  app.post("/api/campaigns", async (req, reply) => {
    const { user } = requireAuth(req);
    const body = parse(campaignBody, req.body);
    const campaign = await campaigns.create(user, body);
    return reply.code(201).send({ campaign: { id: campaign.id } });
  });

  app.get("/api/campaigns/:id", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    return campaigns.detail(await campaigns.membership(id, user.id));
  });

  app.patch("/api/campaigns/:id", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const m = await campaigns.require(id, user.id, "campaign.edit");
    const body = parse(campaignBody.partial(), req.body);
    // Strip defaults that partial() still applies for omitted keys.
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => k in raw));
    await campaigns.update(m, patch);
    changed(id, "settings");
    return campaigns.detail(await campaigns.membership(id, user.id));
  });

  app.delete("/api/campaigns/:id", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await campaigns.require(id, user.id, "campaign.delete");
    await campaigns.softDelete(id);
    app.ctx.realtime?.campaignDeleted(id);
    return { ok: true };
  });

  app.post("/api/campaigns/:id/join", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ password: z.string().max(100).optional() }), req.body ?? {});
    const { created } = await campaigns.joinPublic(id, user, body.password);
    if (created) {
      await chat.system(id, `${user.displayName} joined the campaign.`);
      changed(id, "members");
    }
    return { campaignId: id };
  });

  // ---- Invitations ----

  app.get("/api/invitations/:code", async (req) => {
    const { user } = requireAuth(req);
    const { code } = parse(codeParams, req.params);
    return campaigns.previewInvitation(code, user.id);
  });

  app.post("/api/invitations/:code/accept", async (req) => {
    const { user } = requireAuth(req);
    const { code } = parse(codeParams, req.params);
    const body = parse(z.object({ password: z.string().max(100).optional() }), req.body ?? {});
    const { campaignId, created } = await campaigns.acceptInvitation(code, user, body.password);
    if (created) {
      await chat.system(campaignId, `${user.displayName} joined the campaign.`);
      changed(campaignId, "members");
    }
    return { campaignId };
  });

  app.post("/api/campaigns/:id/invitations", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const m = await campaigns.require(id, user.id, "members.invite");
    const body = parse(
      z.object({
        role: z.enum(CAMPAIGN_ROLES).default("player"),
        maxUses: z.number().int().min(1).max(1000).nullable().default(null),
        expiresInHours: z.number().int().min(1).max(24 * 90).nullable().default(null),
      }),
      req.body ?? {},
    );
    const inv = await campaigns.createInvitation(m, body);
    changed(id, "invitations");
    return reply.code(201).send({ invitation: { id: inv.id, code: inv.code } });
  });

  app.delete("/api/campaigns/:id/invitations/:invitationId", async (req) => {
    const { user } = requireAuth(req);
    const { id, invitationId } = parse(z.object({ id: z.uuid(), invitationId: z.uuid() }), req.params);
    const m = await campaigns.require(id, user.id, "members.invite");
    await campaigns.revokeInvitation(m, invitationId);
    changed(id, "invitations");
    return { ok: true };
  });

  // ---- Members ----

  app.patch("/api/campaigns/:id/members/:userId", async (req) => {
    const { user } = requireAuth(req);
    const { id, userId } = parse(memberParams, req.params);
    const m = await campaigns.require(id, user.id, "members.manage");
    const body = parse(z.object({ role: z.enum(CAMPAIGN_ROLES) }), req.body);
    await campaigns.setRole(m, userId, body.role);
    changed(id, "members");
    return { ok: true };
  });

  app.delete("/api/campaigns/:id/members/:userId", async (req) => {
    const { user } = requireAuth(req);
    const { id, userId } = parse(memberParams, req.params);
    const m = await campaigns.membership(id, user.id);
    if (userId === user.id) {
      await campaigns.leave(m);
      await chat.system(id, `${user.displayName} left the campaign.`);
    } else {
      if (!m.caps.has("members.manage")) throw forbidden();
      await campaigns.removeMember(m, userId);
    }
    app.ctx.realtime?.memberRemoved(id, userId);
    changed(id, "members");
    return { ok: true };
  });

  app.post("/api/campaigns/:id/transfer", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ userId: z.uuid() }), req.body);
    await campaigns.transferOwnership(await campaigns.membership(id, user.id), body.userId);
    changed(id, "members");
    return { ok: true };
  });

  app.put("/api/campaigns/:id/character", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ characterId: z.uuid().nullable() }), req.body);
    await campaigns.selectCharacter(await campaigns.membership(id, user.id), body.characterId);
    changed(id, "members");
    return { ok: true };
  });

  // ---- Game sessions ----

  app.post("/api/campaigns/:id/session/start", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const m = await campaigns.require(id, user.id, "session.control");
    const body = parse(z.object({ name: cleanText(80).optional() }), req.body ?? {});
    const session = await campaigns.startSession(m, body.name);
    await chat.system(id, `${session.name} has started.`);
    changed(id, "session");
    return { session };
  });

  app.post("/api/campaigns/:id/session/:action", async (req) => {
    const { user } = requireAuth(req);
    const { id, action } = parse(z.object({ id: z.uuid(), action: z.enum(["pause", "end"]) }), req.params);
    const m = await campaigns.require(id, user.id, "session.control");
    const session = await campaigns.setSessionStatus(m, action === "pause" ? "paused" : "ended");
    await chat.system(id, `${session.name} ${action === "pause" ? "is paused" : "has ended"}.`);
    changed(id, "session");
    return { session };
  });
}
