import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { CHAT_CHANNELS, FOG_SHAPES, ROLL_VISIBILITIES, canSeeChatMessage, canSeeToken, type CampaignRole, type Capability, type FogShape } from "@vtt/rules";
import { tokenConditionSchema, tokenFields } from "../scenes/routes.js";
import type { CombatEffects } from "../combat/service.js";
import { redactToken, toSceneDto, toTemplateDto, toTokenDto } from "../scenes/service.js";
import { SESSION_COOKIE, type AppContext } from "../context.js";
import { HttpError } from "../lib/errors.js";
import { rollForViewer, viewerFor, type ChatMessageDto, type RollDto } from "../chat/service.js";
import { cleanText } from "../lib/validation.js";
import { canSeeJournal, toJournalDto } from "../dmtools/service.js";
import type { JournalRow, MapTemplateRow } from "../db/schema.js";
import { viewAudio, type AudioSnapshot } from "../audio/service.js";

export type PresenceStatus = "online" | "reconnecting" | "offline";

interface PresenceEntry {
  sockets: Set<string>;
  ready: boolean;
  status: PresenceStatus;
  timer?: NodeJS.Timeout;
}

export interface PresenceView {
  userId: string;
  status: PresenceStatus;
  ready: boolean;
}

type Ack = (res: { ok: true; data?: unknown } | { ok: false; error: string; code?: string }) => void;

interface SocketData {
  userId: string;
  displayName: string;
  campaigns: Set<string>;
  /** Scene each campaign view is showing on this socket (campaignId -> sceneId). */
  scenes: Map<string, string>;
  bucket: { tokens: number; updated: number };
}

const room = (campaignId: string) => `campaign:${campaignId}`;
const sceneRoom = (sceneId: string) => `scene:${sceneId}`;
const userRoom = (userId: string) => `user:${userId}`;

/** Grace period before a disconnected player is shown as offline. */
export const RECONNECT_GRACE_MS = 10_000;

const campaignIdSchema = z.object({ campaignId: z.uuid() });
const chatSendSchema = campaignIdSchema.extend({
  channel: z.enum(CHAT_CHANNELS).exclude(["system"]),
  content: cleanText(2000),
  recipientIds: z.array(z.uuid()).max(20).default([]),
  characterId: z.uuid().nullable().optional(),
});
const rollSchema = campaignIdSchema.extend({
  formula: z.string().max(200),
  mode: z.enum(["normal", "advantage", "disadvantage"]).default("normal"),
  visibility: z.enum(ROLL_VISIBILITIES).default("public"),
  recipientIds: z.array(z.uuid()).max(20).default([]),
  label: cleanText(80).default(""),
  rollType: z.enum(["custom", "check", "save", "skill", "attack", "damage", "initiative", "healing"]).default("custom"),
  characterId: z.uuid().nullable().optional(),
});

const sceneRef = campaignIdSchema.extend({ sceneId: z.uuid() });
const hpAmount = z.number().int().min(0).max(100000);
const hpActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("damage"), amount: hpAmount, damageType: cleanText(30).nullable().optional() }),
  z.object({ kind: z.literal("heal"), amount: hpAmount }),
  z.object({ kind: z.literal("temp"), amount: hpAmount }),
  z.object({
    kind: z.literal("set"),
    current: z.number().int().min(-10000).max(10000),
    max: z.number().int().min(0).max(10000).optional(),
    temp: z.number().int().min(0).max(10000).optional(),
  }),
]);
const combatantRef = campaignIdSchema.extend({ combatantId: z.uuid() });
const actionsPatch = z
  .object({ action: z.boolean(), bonusAction: z.boolean(), reaction: z.boolean(), freeInteraction: z.boolean(), movementUsed: z.number().min(0).max(10000) })
  .partial();
const point = z.object({ x: z.number(), y: z.number() });
const volume = z.number().min(0).max(1);
const templateFields = z.object({
  shape: z.enum(["circle", "cone", "line", "square"]),
  x: z.number().min(-1e6).max(1e6),
  y: z.number().min(-1e6).max(1e6),
  size: z.number().min(1).max(1000),
  width: z.number().min(1).max(100).default(5),
  angle: z.number().min(-3600).max(3600).default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#e0603a"),
  label: cleanText(60).default(""),
  hidden: z.boolean().default(false),
});
/** Same fields without defaults, so an update only touches what was sent. */
const templatePatch = z
  .object({
    x: templateFields.shape.x,
    y: templateFields.shape.y,
    size: templateFields.shape.size,
    width: z.number().min(1).max(100),
    angle: z.number().min(-3600).max(3600),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    label: cleanText(60),
    hidden: z.boolean(),
  })
  .partial();
const audioControlSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("playTrack"), trackId: z.uuid() }),
  z.object({ kind: z.literal("playPlaylist"), playlistId: z.uuid(), trackId: z.uuid().optional(), shuffle: z.boolean().optional() }),
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("stop") }),
  z.object({ kind: z.literal("next") }),
  z.object({ kind: z.literal("prev") }),
  z.object({ kind: z.literal("seek"), position: z.number().min(0).max(6 * 3600) }),
  z.object({ kind: z.literal("musicVolume"), volume }),
  z.object({ kind: z.literal("loop"), loop: z.enum(["off", "track", "queue"]) }),
  z.object({ kind: z.literal("ambientAdd"), trackId: z.uuid(), volume: volume.optional() }),
  z.object({ kind: z.literal("ambientRemove"), layerId: z.uuid() }),
  z.object({ kind: z.literal("ambientVolume"), layerId: z.uuid(), volume }),
  z.object({ kind: z.literal("ambientToggle"), layerId: z.uuid(), playing: z.boolean() }),
  z.object({ kind: z.literal("stopAll") }),
]);
const fogShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(FOG_SHAPES[0]), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  z.object({ kind: z.literal(FOG_SHAPES[1]), x: z.number(), y: z.number(), radius: z.number() }),
  z.object({ kind: z.literal(FOG_SHAPES[2]), points: z.array(point).min(3).max(200) }),
]);

export class Realtime {
  readonly io: Server;
  private presence = new Map<string, Map<string, PresenceEntry>>();
  /** Per-campaign timer that advances the music queue when a track ends. */
  private audioTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly ctx: AppContext,
  ) {
    const origin = ctx.config.WEB_ORIGIN;
    this.io = new Server(app.server, {
      path: "/socket.io",
      cors: { origin, credentials: true },
      // Cross-site WebSocket hijacking guard: browsers always send Origin.
      allowRequest: (req, cb) => {
        const o = req.headers.origin;
        const host = req.headers.host;
        const ok = !o || o === origin || (host !== undefined && (o === `http://${host}` || o === `https://${host}`));
        cb(null, ok);
      },
      maxHttpBufferSize: 256 * 1024,
    });
    this.io.use(async (socket, next) => {
      try {
        const cookies = app.parseCookie(socket.handshake.headers.cookie ?? "");
        const token = cookies[SESSION_COOKIE];
        const session = token ? await ctx.auth.resolveSession(token) : null;
        if (!session) return next(new Error("unauthorized"));
        const data = socket.data as SocketData;
        data.userId = session.user.id;
        data.displayName = session.user.displayName;
        data.campaigns = new Set();
        data.scenes = new Map();
        data.bucket = { tokens: 60, updated: Date.now() };
        next();
      } catch {
        next(new Error("unauthorized"));
      }
    });
    this.io.on("connection", (s) => this.onConnection(s));
  }

  // ---- Presence ----------------------------------------------------------

  presenceFor(campaignId: string): PresenceView[] {
    const map = this.presence.get(campaignId);
    if (!map) return [];
    return [...map.entries()].map(([userId, e]) => ({ userId, status: e.status, ready: e.ready }));
  }

  private emitPresence(campaignId: string) {
    this.io.to(room(campaignId)).emit("presence:update", { campaignId, presence: this.presenceFor(campaignId) });
  }

  private addPresence(campaignId: string, userId: string, socketId: string) {
    let map = this.presence.get(campaignId);
    if (!map) this.presence.set(campaignId, (map = new Map()));
    let entry = map.get(userId);
    if (!entry) map.set(userId, (entry = { sockets: new Set(), ready: false, status: "online" }));
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.sockets.add(socketId);
    entry.status = "online";
    this.emitPresence(campaignId);
  }

  private removePresence(campaignId: string, userId: string, socketId: string, graceful: boolean) {
    const entry = this.presence.get(campaignId)?.get(userId);
    if (!entry) return;
    entry.sockets.delete(socketId);
    if (entry.sockets.size > 0) return;
    if (graceful) {
      this.presence.get(campaignId)?.delete(userId);
      this.emitPresence(campaignId);
      return;
    }
    // Unexpected disconnect: show "reconnecting" first, keep ready state for a quick return.
    entry.status = "reconnecting";
    this.emitPresence(campaignId);
    entry.timer = setTimeout(() => {
      const current = this.presence.get(campaignId)?.get(userId);
      if (current && current.sockets.size === 0) {
        this.presence.get(campaignId)?.delete(userId);
        this.emitPresence(campaignId);
      }
    }, RECONNECT_GRACE_MS);
    entry.timer.unref?.();
  }

  // ---- Socket handlers ---------------------------------------------------

  private rateLimited(s: Socket): boolean {
    const b = (s.data as SocketData).bucket;
    const now = Date.now();
    b.tokens = Math.min(60, b.tokens + ((now - b.updated) / 1000) * 15);
    b.updated = now;
    if (b.tokens < 1) return true;
    b.tokens -= 1;
    return false;
  }

  private handle<T extends z.ZodType>(
    s: Socket,
    event: string,
    schema: T,
    fn: (input: z.infer<T>, data: SocketData) => Promise<unknown>,
  ) {
    s.on(event, async (raw: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === "function" ? ack : () => {};
      if (this.rateLimited(s)) return reply({ ok: false, error: "You're doing that too fast", code: "rate_limited" });
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const i = parsed.error.issues[0];
        return reply({ ok: false, error: i ? `${i.path.join(".")}: ${i.message}` : "Invalid input", code: "bad_request" });
      }
      try {
        const data = await fn(parsed.data, s.data as SocketData);
        reply({ ok: true, data });
      } catch (e) {
        if (e instanceof HttpError) return reply({ ok: false, error: e.message, code: e.code });
        this.app.log.error({ err: e, event }, "socket handler failed");
        reply({ ok: false, error: "Something went wrong", code: "internal" });
      }
    });
  }

  private onConnection(s: Socket) {
    const data = s.data as SocketData;
    void s.join(userRoom(data.userId));
    const { campaigns, chat } = this.ctx;

    this.handle(s, "campaign:join", campaignIdSchema, async ({ campaignId }) => {
      const m = await campaigns.membership(campaignId, data.userId);
      await s.join(room(campaignId));
      data.campaigns.add(campaignId);
      this.addPresence(campaignId, data.userId, s.id);
      const [messages, rolls] = await Promise.all([
        chat.history(m, { limit: 100 }),
        chat.rollHistory(m, { limit: 50 }),
      ]);
      const combatState = await this.ctx.combat.state(m);
      const audioSnap = await this.ctx.audio.snapshot(campaignId);
      this.scheduleAudio(campaignId, audioSnap);
      return { presence: this.presenceFor(campaignId), messages, rolls, combat: combatState, audio: viewAudio(audioSnap, m.caps, Date.now()) };
    });

    this.handle(s, "campaign:leave", campaignIdSchema, async ({ campaignId }) => {
      this.leaveRoom(s, campaignId, true);
    });

    this.handle(s, "lobby:ready", campaignIdSchema.extend({ ready: z.boolean() }), async ({ campaignId, ready }) => {
      await campaigns.membership(campaignId, data.userId);
      const entry = this.presence.get(campaignId)?.get(data.userId);
      if (!entry) throw new HttpError(400, "bad_request", "Join the lobby first");
      entry.ready = ready;
      this.emitPresence(campaignId);
    });

    this.handle(s, "chat:send", chatSendSchema, async ({ campaignId, ...input }) => {
      return chat.send(await campaigns.membership(campaignId, data.userId), input);
    });

    this.handle(s, "chat:edit", campaignIdSchema.extend({ messageId: z.uuid(), content: cleanText(2000) }), async (i) => {
      return chat.edit(await campaigns.membership(i.campaignId, data.userId), i.messageId, i.content);
    });

    this.handle(s, "chat:delete", campaignIdSchema.extend({ messageId: z.uuid() }), async (i) => {
      return chat.remove(await campaigns.membership(i.campaignId, data.userId), i.messageId);
    });

    this.handle(s, "dice:roll", rollSchema, async ({ campaignId, ...input }) => {
      const m = await campaigns.membership(campaignId, data.userId);
      const dto = await chat.roll(m, input);
      // The roller gets their own view of the result (redacted for blind rolls).
      return rollForViewer(dto, viewerFor(data.userId, m.role));
    });

    // ---- Music & ambience -------------------------------------------------

    this.handle(s, "audio:control", campaignIdSchema.extend({ action: audioControlSchema }), async ({ campaignId, action }) => {
      const m = await campaigns.membership(campaignId, data.userId);
      const snap = await this.ctx.audio.control(m, action);
      await this.audioChanged(campaignId, snap);
      return viewAudio(snap, m.caps, Date.now());
    });

    this.handle(s, "audio:sync", campaignIdSchema, async ({ campaignId }) => {
      const m = await campaigns.membership(campaignId, data.userId);
      return viewAudio(await this.ctx.audio.snapshot(campaignId), m.caps, Date.now());
    });

    this.handle(s, "audio:sfx", campaignIdSchema.extend({ trackId: z.uuid(), volume: volume.default(1) }), async ({ campaignId, trackId, volume: v }) => {
      const m = await campaigns.membership(campaignId, data.userId);
      const track = await this.ctx.audio.sfx(m, trackId);
      this.io.to(room(campaignId)).emit("audio:sfx", { campaignId, track, volume: v });
    });

    // ---- AoE templates ------------------------------------------------------

    this.handle(s, "template:create", sceneRef.extend({ template: templateFields }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const row = await this.ctx.scenes.createTemplate(m, i.sceneId, i.template);
      await this.broadcastTemplate(i.campaignId, i.sceneId, null, row);
      return toTemplateDto(row);
    });

    this.handle(s, "template:update", sceneRef.extend({ templateId: z.uuid(), patch: templatePatch }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const { before, after } = await this.ctx.scenes.updateTemplate(m, i.sceneId, i.templateId, i.patch);
      await this.broadcastTemplate(i.campaignId, i.sceneId, before, after);
      return toTemplateDto(after);
    });

    this.handle(s, "template:delete", sceneRef.extend({ templateId: z.uuid() }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const row = await this.ctx.scenes.deleteTemplate(m, i.sceneId, i.templateId);
      await this.broadcastTemplate(i.campaignId, i.sceneId, row, null);
    });

    this.handle(s, "template:clear", sceneRef, async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      await this.ctx.scenes.clearTemplates(m, i.sceneId);
      await this.sendSceneState(i.campaignId, i.sceneId);
    });

    // ---- Scenes / tokens / fog -------------------------------------------

    const { scenes } = this.ctx;

    this.handle(s, "scene:join", sceneRef, async ({ campaignId, sceneId }) => {
      const m = await campaigns.membership(campaignId, data.userId);
      const state = await scenes.stateFor(m, sceneId);
      const prev = data.scenes.get(campaignId);
      if (prev && prev !== sceneId) await s.leave(sceneRoom(prev));
      await s.join(sceneRoom(sceneId));
      data.scenes.set(campaignId, sceneId);
      return state;
    });

    this.handle(s, "scene:leave", sceneRef, async ({ campaignId, sceneId }) => {
      if (data.scenes.get(campaignId) === sceneId) data.scenes.delete(campaignId);
      await s.leave(sceneRoom(sceneId));
    });

    this.handle(s, "token:create", sceneRef.extend({ token: tokenFields.partial().required({ x: true, y: true }) }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const dto = await scenes.createToken(m, i.sceneId, i.token);
      await this.broadcastToken(i.campaignId, i.sceneId, dto.id);
      return dto;
    });

    this.handle(s, "token:update", sceneRef.extend({ tokenId: z.uuid(), patch: tokenFields.partial() }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const dto = await scenes.updateToken(m, i.sceneId, i.tokenId, i.patch);
      await this.broadcastToken(i.campaignId, i.sceneId, dto.id);
      return dto;
    });

    this.handle(s, "token:delete", sceneRef.extend({ tokenId: z.uuid() }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const dto = await scenes.deleteToken(m, i.sceneId, i.tokenId);
      this.io.to(sceneRoom(i.sceneId)).emit("token:remove", { sceneId: i.sceneId, tokenId: dto.id });
      return { id: dto.id };
    });

    this.handle(s, "fog:add", sceneRef.extend({ mode: z.enum(["reveal", "hide"]), shape: fogShapeSchema }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const op = await scenes.addFog(m, i.sceneId, i.mode, i.shape as FogShape);
      await this.sendSceneState(i.campaignId, i.sceneId);
      return op;
    });

    this.handle(s, "fog:reset", sceneRef.extend({ mode: z.enum(["reveal", "hide"]) }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      await scenes.resetFog(m, i.sceneId, i.mode);
      await this.sendSceneState(i.campaignId, i.sceneId);
    });

    this.handle(s, "fog:undo", sceneRef, async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const undone = await scenes.undoFog(m, i.sceneId);
      if (undone) await this.sendSceneState(i.campaignId, i.sceneId);
      return { undone };
    });

    this.handle(s, "fog:enable", sceneRef.extend({ enabled: z.boolean() }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      await scenes.setFogEnabled(m, i.sceneId, i.enabled);
      await this.sendSceneState(i.campaignId, i.sceneId);
    });

    // ---- Combat -----------------------------------------------------------

    const { combat } = this.ctx;
    /** Runs a combat mutation, then pushes the new state (and any side-effect tokens) to everyone. */
    const combatOp = async (campaignId: string, fn: (m: Awaited<ReturnType<typeof campaigns.membership>>) => Promise<CombatEffects | void>) => {
      const m = await campaigns.membership(campaignId, data.userId);
      const fx = await fn(m);
      if (fx) await this.applyEffects(campaignId, fx);
      await this.broadcastCombat(campaignId);
      return combat.state(m);
    };

    this.handle(s, "combat:get", campaignIdSchema, async ({ campaignId }) => {
      return combat.state(await campaigns.membership(campaignId, data.userId));
    });

    this.handle(s, "combat:start", sceneRef.extend({ tokenIds: z.array(z.uuid()).max(100).optional() }), async (i) =>
      combatOp(i.campaignId, (m) => combat.start(m, i.sceneId, i.tokenIds)),
    );

    this.handle(s, "combat:end", campaignIdSchema, async (i) => combatOp(i.campaignId, (m) => combat.end(m)));

    this.handle(s, "combat:add", campaignIdSchema.extend({ tokenIds: z.array(z.uuid()).min(1).max(100) }), async (i) =>
      combatOp(i.campaignId, (m) => combat.addTokens(m, i.tokenIds)),
    );

    this.handle(
      s,
      "combat:addCustom",
      campaignIdSchema.extend({ name: cleanText(60).pipe(z.string().min(1)), initiativeBonus: z.number().int().min(-20).max(50).default(0), hidden: z.boolean().default(false) }),
      async ({ campaignId, ...input }) => combatOp(campaignId, (m) => combat.addCustom(m, input)),
    );

    this.handle(s, "combat:remove", combatantRef, async (i) => combatOp(i.campaignId, (m) => combat.remove(m, i.combatantId)));

    this.handle(
      s,
      "combat:roll",
      campaignIdSchema.extend({ which: z.union([z.enum(["all", "npcs"]), z.array(z.uuid()).min(1).max(100)]) }),
      async (i) => combatOp(i.campaignId, (m) => combat.rollInitiative(m, i.which)),
    );

    this.handle(s, "combat:setInitiative", combatantRef.extend({ value: z.number().int().min(-100).max(1000).nullable() }), async (i) =>
      combatOp(i.campaignId, (m) => combat.setInitiative(m, i.combatantId, i.value)),
    );

    this.handle(s, "combat:next", campaignIdSchema.extend({ expectedVersion: z.number().int().min(1).optional() }), async (i) =>
      combatOp(i.campaignId, (m) => combat.next(m, i.expectedVersion)),
    );

    this.handle(s, "combat:prev", campaignIdSchema, async (i) => combatOp(i.campaignId, (m) => combat.previous(m)));

    this.handle(
      s,
      "combat:update",
      combatantRef.extend({
        patch: z.object({ hidden: z.boolean(), defeated: z.boolean(), name: cleanText(60).pipe(z.string().min(1)), actions: actionsPatch }).partial(),
      }),
      async (i) => combatOp(i.campaignId, (m) => combat.updateCombatant(m, i.combatantId, i.patch)),
    );

    this.handle(s, "token:hp", campaignIdSchema.extend({ tokenId: z.uuid(), action: hpActionSchema }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const res = await combat.applyHp(m, i.tokenId, i.action);
      await this.applyEffects(i.campaignId, res.fx);
      await this.broadcastCombat(i.campaignId);
      return { token: res.token, notes: res.notes, effective: res.effective };
    });

    this.handle(s, "token:conditions", campaignIdSchema.extend({ tokenId: z.uuid(), conditions: z.array(tokenConditionSchema).max(30) }), async (i) => {
      const m = await campaigns.membership(i.campaignId, data.userId);
      const res = await combat.setConditions(m, i.tokenId, i.conditions);
      await this.applyEffects(i.campaignId, res.fx);
      await this.broadcastCombat(i.campaignId);
      return res.token;
    });

    s.on("disconnect", () => {
      for (const campaignId of data.campaigns) this.removePresence(campaignId, data.userId, s.id, false);
    });
  }

  private leaveRoom(s: Socket, campaignId: string, graceful: boolean) {
    const data = s.data as SocketData;
    void s.leave(room(campaignId));
    data.campaigns.delete(campaignId);
    const sceneId = data.scenes.get(campaignId);
    if (sceneId) void s.leave(sceneRoom(sceneId));
    data.scenes.delete(campaignId);
    this.removePresence(campaignId, data.userId, s.id, graceful);
  }

  // ---- Server-originated broadcasts -------------------------------------

  /** Sends a per-recipient payload to every socket in a campaign room. */
  private async tailored(campaignId: string, event: string, build: (userId: string, role: CampaignRole) => unknown | null) {
    const [sockets, roles] = await Promise.all([
      this.io.in(room(campaignId)).fetchSockets(),
      this.ctx.campaigns.memberRoles(campaignId),
    ]);
    for (const sock of sockets) {
      const userId = (sock.data as SocketData).userId;
      const role = roles.get(userId);
      if (!role) continue;
      const payload = build(userId, role);
      if (payload !== null) sock.emit(event, payload);
    }
  }

  /** Like `tailored`, but builds each payload from the member's effective capabilities. */
  private async tailoredCaps(campaignId: string, build: (userId: string, caps: Set<Capability>) => Array<[string, unknown]>) {
    const [sockets, caps] = await Promise.all([this.io.in(room(campaignId)).fetchSockets(), this.ctx.campaigns.memberCaps(campaignId)]);
    for (const sock of sockets) {
      const userId = (sock.data as SocketData).userId;
      const c = caps.get(userId);
      if (!c) continue;
      for (const [event, payload] of build(userId, c)) sock.emit(event, payload);
    }
  }

  /**
   * Journal change: viewers who can read the new version get it; viewers who could read
   * the old one but not the new one get a removal. Nobody else hears about the entry.
   */
  journalChanged(campaignId: string, before: JournalRow | null, after: JournalRow | null) {
    void this.tailoredCaps(campaignId, (userId, caps) => {
      const v = { userId, manager: caps.has("journal.manage") };
      if (after && canSeeJournal(after, v)) return [["journal:upsert", { campaignId, entry: toJournalDto(after, v) }]];
      if (before && canSeeJournal(before, v)) return [["journal:remove", { campaignId, id: before.id }]];
      return [];
    }).catch((err) => this.app.log.error({ err }, "journalChanged failed"));
  }

  /** Pops a handout up on the chosen members' screens (only those who can read it). */
  handoutShown(campaignId: string, entry: JournalRow, recipients: "all" | string[], senderId: string) {
    void this.tailoredCaps(campaignId, (userId, caps) => {
      const v = { userId, manager: caps.has("journal.manage") };
      if (userId === senderId || !canSeeJournal(entry, v)) return [];
      if (recipients !== "all" && !recipients.includes(userId)) return [];
      return [["handout:show", { campaignId, entry: toJournalDto(entry, v) }]];
    }).catch((err) => this.app.log.error({ err }, "handoutShown failed"));
  }

  /** Pushes each member's view of the playback state and re-arms the end-of-track timer. */
  async audioChanged(campaignId: string, snap?: AudioSnapshot) {
    try {
      const current = snap ?? (await this.ctx.audio.snapshot(campaignId));
      const now = Date.now();
      await this.tailoredCaps(campaignId, (_userId, caps) => [["audio:state", { campaignId, audio: viewAudio(current, caps, now) }]]);
      this.scheduleAudio(campaignId, current);
    } catch (err) {
      this.app.log.error({ err }, "audioChanged failed");
    }
  }

  private scheduleAudio(campaignId: string, snap: AudioSnapshot) {
    const prev = this.audioTimers.get(campaignId);
    if (prev) clearTimeout(prev);
    this.audioTimers.delete(campaignId);
    const at = this.ctx.audio.nextChangeAt(snap);
    if (at === null) return;
    // A little after the end, so the snapshot sees the track as finished.
    const timer = setTimeout(() => {
      this.audioTimers.delete(campaignId);
      void this.audioChanged(campaignId);
    }, Math.min(Math.max(0, at - Date.now()) + 250, 2 ** 31 - 1));
    timer.unref?.();
    this.audioTimers.set(campaignId, timer);
  }

  broadcastChat(msg: ChatMessageDto) {
    void this.tailored(msg.campaignId, "chat:message", (userId, role) =>
      canSeeChatMessage(msg.channel, { authorId: msg.senderId ?? "", recipientIds: msg.recipientIds }, viewerFor(userId, role))
        ? msg
        : null,
    ).catch((err) => this.app.log.error({ err }, "broadcastChat failed"));
  }

  broadcastRoll(roll: Required<Omit<RollDto, "redacted">>) {
    void this.tailored(roll.campaignId, "dice:roll", (userId, role) => rollForViewer(roll, viewerFor(userId, role))).catch(
      (err) => this.app.log.error({ err }, "broadcastRoll failed"),
    );
  }

  // ---- Scene broadcasts ---------------------------------------------------

  /** Sockets currently viewing a scene, with their effective capabilities. */
  private async sceneViewers(campaignId: string, sceneId: string) {
    const [sockets, caps] = await Promise.all([this.io.in(sceneRoom(sceneId)).fetchSockets(), this.ctx.campaigns.memberCaps(campaignId)]);
    return sockets.flatMap((sock) => {
      const userId = (sock.data as SocketData).userId;
      const c = caps.get(userId);
      return c ? [{ sock, userId, caps: c }] : [];
    });
  }

  /**
   * Sends a token's current state to each viewer (re-read from the DB so every viewer gets
   * the unredacted source and its own redaction), or a removal to viewers who mustn't see it.
   */
  /** Template change: hidden templates reach only GMs; un-hiding/hiding adds/removes for players. */
  async broadcastTemplate(campaignId: string, sceneId: string, before: MapTemplateRow | null, after: MapTemplateRow | null) {
    try {
      for (const v of await this.sceneViewers(campaignId, sceneId)) {
        const isGM = v.caps.has("token.manageAll");
        if (after && (!after.hidden || isGM)) v.sock.emit("template:upsert", toTemplateDto(after));
        else if (before && (!before.hidden || isGM)) v.sock.emit("template:remove", { sceneId, templateId: before.id });
      }
    } catch (err) {
      this.app.log.error({ err }, "broadcastTemplate failed");
    }
  }

  async broadcastToken(campaignId: string, sceneId: string, tokenId: string) {
    try {
      const scene = await this.ctx.scenes.viewableRaw(campaignId, sceneId);
      if (!scene) return;
      const [{ state }, dto] = await Promise.all([this.ctx.scenes.fogState(scene), this.ctx.scenes.tokenDto(tokenId)]);
      for (const v of await this.sceneViewers(campaignId, sceneId)) {
        const viewer = { userId: v.userId, isGameMaster: v.caps.has("token.manageAll") };
        if (dto && canSeeToken(dto, viewer, state)) v.sock.emit("token:upsert", redactToken(dto, viewer));
        else v.sock.emit("token:remove", { sceneId, tokenId });
      }
    } catch (err) {
      this.app.log.error({ err }, "broadcastToken failed");
    }
  }

  /** Pushes the full, per-viewer filtered scene state (after fog/scene changes). */
  async sendSceneState(campaignId: string, sceneId: string) {
    try {
      const scene = await this.ctx.scenes.viewableRaw(campaignId, sceneId);
      if (!scene) return;
      const [{ state, ops }, rows, activeSceneId, templates] = await Promise.all([
        this.ctx.scenes.fogState(scene),
        this.ctx.scenes.tokenRows(sceneId),
        this.ctx.scenes.activeSceneId(campaignId),
        this.ctx.scenes.templateRows(sceneId),
      ]);
      const all = rows.map((r) => toTokenDto(r.token, r.character));
      for (const v of await this.sceneViewers(campaignId, sceneId)) {
        const isGM = v.caps.has("token.manageAll");
        if (!v.caps.has("map.manage") && activeSceneId !== sceneId) {
          v.sock.leave(sceneRoom(sceneId));
          continue;
        }
        const viewer = { userId: v.userId, isGameMaster: isGM };
        v.sock.emit("scene:state", {
          scene: toSceneDto(scene, activeSceneId, v.caps.has("dmNotes.view")),
          tokens: all.filter((t) => canSeeToken(t, viewer, state)).map((t) => redactToken(t, viewer)),
          fog: ops,
          templates: templates.filter((t) => !t.hidden || isGM).map(toTemplateDto),
        });
      }
    } catch (err) {
      this.app.log.error({ err }, "sendSceneState failed");
    }
  }

  scenesChanged(campaignId: string) {
    this.io.to(room(campaignId)).emit("scenes:changed", { campaignId });
  }

  /** Moves players to the new active scene and evicts non-GMs from the previous one. */
  async sceneActivated(campaignId: string, previous: string | null, sceneId: string | null) {
    if (previous && previous !== sceneId) {
      for (const v of await this.sceneViewers(campaignId, previous)) {
        if (!v.caps.has("map.manage")) v.sock.leave(sceneRoom(previous));
      }
    }
    this.io.to(room(campaignId)).emit("scene:activated", { campaignId, sceneId });
  }

  async sceneDeleted(campaignId: string, sceneId: string) {
    this.io.to(sceneRoom(sceneId)).emit("scene:deleted", { campaignId, sceneId });
    this.io.in(sceneRoom(sceneId)).socketsLeave(sceneRoom(sceneId));
  }

  /** Tells clients to refetch campaign detail (they re-fetch through permission-checked REST). */
  campaignChanged(campaignId: string, reason: string) {
    this.io.to(room(campaignId)).emit("campaign:changed", { campaignId, reason });
  }

  characterChanged(campaignId: string, characterId: string) {
    this.io.to(room(campaignId)).emit("character:changed", { campaignId, characterId });
    // HP/AC/conditions on linked tokens and in the tracker come from the sheet.
    void this.applyEffects(campaignId, { tokenIds: new Set(), characterIds: new Set([characterId]), notifyCharacters: false })
      .then(() => this.broadcastCombat(campaignId))
      .catch((err) => this.app.log.error({ err }, "characterChanged fan-out failed"));
  }

  // ---- Combat broadcasts -----------------------------------------------------

  /** Pushes each member's own view of the running combat (hidden combatants and vitals filtered). */
  async broadcastCombat(campaignId: string) {
    try {
      const [sockets, caps] = await Promise.all([this.io.in(room(campaignId)).fetchSockets(), this.ctx.campaigns.memberCaps(campaignId)]);
      const cache = new Map<string, unknown>();
      for (const sock of sockets) {
        const userId = (sock.data as SocketData).userId;
        const c = caps.get(userId);
        if (!c) continue;
        if (!cache.has(userId)) cache.set(userId, await this.ctx.combat.stateFor(campaignId, { userId, isGameMaster: c.has("token.manageAll") }));
        sock.emit("combat:state", { campaignId, combat: cache.get(userId) });
      }
    } catch (err) {
      this.app.log.error({ err }, "broadcastCombat failed");
    }
  }

  /** Re-broadcasts tokens touched by a combat change (directly, or through their linked character sheet). */
  async applyEffects(campaignId: string, fx: CombatEffects & { notifyCharacters?: boolean }) {
    const targets = new Map<string, string>();
    if (fx.tokenIds.size) {
      for (const t of await this.ctx.scenes.tokenScenes([...fx.tokenIds])) targets.set(t.id, t.sceneId);
    }
    for (const characterId of fx.characterIds) {
      if (fx.notifyCharacters !== false) this.io.to(room(campaignId)).emit("character:changed", { campaignId, characterId });
      for (const t of await this.ctx.scenes.tokensForCharacter(characterId)) if (t.campaignId === campaignId) targets.set(t.id, t.sceneId);
    }
    await Promise.all([...targets].map(([tokenId, sceneId]) => this.broadcastToken(campaignId, sceneId, tokenId)));
  }

  async memberRemoved(campaignId: string, userId: string) {
    const sockets = await this.io.in(userRoom(userId)).fetchSockets();
    for (const sock of sockets) {
      sock.leave(room(campaignId));
      (sock.data as SocketData).campaigns?.delete(campaignId);
      sock.emit("campaign:removed", { campaignId });
    }
    this.presence.get(campaignId)?.delete(userId);
    this.emitPresence(campaignId);
  }

  campaignDeleted(campaignId: string) {
    this.io.to(room(campaignId)).emit("campaign:removed", { campaignId });
    this.io.in(room(campaignId)).socketsLeave(room(campaignId));
    this.presence.delete(campaignId);
  }

  async refreshUser(userId: string) {
    const sockets = await this.io.in(userRoom(userId)).fetchSockets();
    const campaignIds = new Set<string>();
    for (const sock of sockets) for (const c of (sock.data as SocketData).campaigns ?? []) campaignIds.add(c);
    for (const c of campaignIds) this.campaignChanged(c, "members");
  }

  stopTimers() {
    for (const t of this.audioTimers.values()) clearTimeout(t);
    this.audioTimers.clear();
  }

  async close() {
    this.stopTimers();
    for (const map of this.presence.values()) for (const e of map.values()) if (e.timer) clearTimeout(e.timer);
    await this.io.close();
  }
}
