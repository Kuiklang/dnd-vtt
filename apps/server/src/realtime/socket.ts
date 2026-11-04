import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { CHAT_CHANNELS, ROLL_VISIBILITIES, canSeeChatMessage, type CampaignRole } from "@vtt/rules";
import { SESSION_COOKIE, type AppContext } from "../context.js";
import { HttpError } from "../lib/errors.js";
import { rollForViewer, viewerFor, type ChatMessageDto, type RollDto } from "../chat/service.js";
import { cleanText } from "../lib/validation.js";

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
  bucket: { tokens: number; updated: number };
}

const room = (campaignId: string) => `campaign:${campaignId}`;
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

export class Realtime {
  readonly io: Server;
  private presence = new Map<string, Map<string, PresenceEntry>>();

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
        data.bucket = { tokens: 30, updated: Date.now() };
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
    b.tokens = Math.min(30, b.tokens + ((now - b.updated) / 1000) * 5);
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
      return { presence: this.presenceFor(campaignId), messages, rolls };
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
      const dto = await chat.roll(await campaigns.membership(campaignId, data.userId), input);
      return { id: dto.id };
    });

    s.on("disconnect", () => {
      for (const campaignId of data.campaigns) this.removePresence(campaignId, data.userId, s.id, false);
    });
  }

  private leaveRoom(s: Socket, campaignId: string, graceful: boolean) {
    const data = s.data as SocketData;
    void s.leave(room(campaignId));
    data.campaigns.delete(campaignId);
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

  /** Tells clients to refetch campaign detail (they re-fetch through permission-checked REST). */
  campaignChanged(campaignId: string, reason: string) {
    this.io.to(room(campaignId)).emit("campaign:changed", { campaignId, reason });
  }

  characterChanged(campaignId: string, characterId: string) {
    this.io.to(room(campaignId)).emit("character:changed", { campaignId, characterId });
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

  async close() {
    for (const map of this.presence.values()) for (const e of map.values()) if (e.timer) clearTimeout(e.timer);
    await this.io.close();
  }
}
