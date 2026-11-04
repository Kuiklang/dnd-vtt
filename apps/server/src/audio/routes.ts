import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AUDIO_CATEGORIES, MAX_TRACK_SECONDS } from "@vtt/rules";
import { requireAuth } from "../auth/routes.js";
import { cleanText, parse } from "../lib/validation.js";

const campaignParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

const trackFields = z.object({
  name: cleanText(100).pipe(z.string().min(1, "Name is required")),
  category: z.enum(AUDIO_CATEGORIES),
  tags: z.array(cleanText(30).pipe(z.string().min(1))).max(12),
  durationSec: z.number().positive().max(MAX_TRACK_SECONDS).nullable(),
});
const playlistFields = z.object({
  name: cleanText(80).pipe(z.string().min(1, "Name is required")),
  trackIds: z.array(z.uuid()).max(200),
});

/** Music library (tracks and playlists). Live playback goes over Socket.IO (`audio:*`). */
export async function audioRoutes(app: FastifyInstance) {
  const { campaigns, audio } = app.ctx;
  const member = async (req: Parameters<typeof requireAuth>[0], campaignId: string) => campaigns.membership(campaignId, requireAuth(req).user.id);

  app.get("/api/campaigns/:id/audio", async (req) => {
    const { id } = parse(campaignParams, req.params);
    return audio.library(await member(req, id));
  });

  app.post("/api/campaigns/:id/audio/tracks", async (req, reply) => {
    const { id } = parse(campaignParams, req.params);
    const body = parse(trackFields.partial({ tags: true, durationSec: true, category: true }).extend({ assetId: z.uuid() }), req.body);
    const track = await audio.createTrack(await member(req, id), { tags: [], durationSec: null, category: "music", ...body });
    return reply.code(201).send({ track });
  });

  app.put("/api/campaigns/:id/audio/tracks/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    return { track: await audio.updateTrack(await member(req, id), itemId, parse(trackFields.partial(), req.body)) };
  });

  app.delete("/api/campaigns/:id/audio/tracks/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    await audio.deleteTrack(await member(req, id), itemId);
    await app.ctx.realtime?.audioChanged(id);
    return { ok: true };
  });

  app.post("/api/campaigns/:id/audio/playlists", async (req, reply) => {
    const { id } = parse(campaignParams, req.params);
    const body = parse(playlistFields.partial({ trackIds: true }), req.body);
    return reply.code(201).send({ playlist: await audio.createPlaylist(await member(req, id), { trackIds: [], ...body }) });
  });

  app.put("/api/campaigns/:id/audio/playlists/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    const { expectedVersion, ...patch } = parse(playlistFields.partial().extend({ expectedVersion: z.number().int().min(1) }), req.body);
    return { playlist: await audio.updatePlaylist(await member(req, id), itemId, expectedVersion, patch) };
  });

  app.delete("/api/campaigns/:id/audio/playlists/:itemId", async (req) => {
    const { id, itemId } = parse(itemParams, req.params);
    await audio.deletePlaylist(await member(req, id), itemId);
    return { ok: true };
  });
}
