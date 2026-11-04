import type { Server, Socket } from "socket.io";
import { z } from "zod";

/**
 * Voice chat signalling (Phase 8). Audio goes peer to peer between browsers over WebRTC
 * (a "mesh": fine for a table of up to ~8 people); the server only introduces peers and
 * relays their connection offers, answers and network candidates. It never sees audio.
 *
 * Only members who joined the campaign's voice channel can signal each other, and only
 * inside the same campaign.
 */

export const MAX_VOICE_PEERS = 12;

export interface VoicePeer {
  peerId: string;
  userId: string;
  name: string;
  muted: boolean;
}

/** Offers/answers and ICE candidates: opaque to the server but size-limited. */
export const signalSchema = z.object({
  campaignId: z.uuid(),
  to: z.string().min(1).max(64),
  data: z.union([
    z.object({ sdp: z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().max(30_000) }) }),
    z.object({
      candidate: z.object({
        candidate: z.string().max(1000),
        sdpMid: z.string().max(64).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional(),
      }),
    }),
  ]),
});

const voiceRoom = (campaignId: string) => `voice:${campaignId}`;

export class VoiceChannels {
  /** campaignId → socket id → peer. */
  private channels = new Map<string, Map<string, VoicePeer>>();
  /** Separate, roomier budget for signalling (connection setup sends bursts of candidates). */
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly io: Server,
    /** ICE servers handed to browsers (STUN, optionally TURN). */
    readonly iceServers: RTCIceServerLike[],
  ) {}

  peers(campaignId: string): VoicePeer[] {
    return [...(this.channels.get(campaignId)?.values() ?? [])];
  }

  join(s: Socket, campaignId: string, userId: string, name: string): { peers: VoicePeer[]; self: string; iceServers: RTCIceServerLike[] } {
    let ch = this.channels.get(campaignId);
    if (!ch) this.channels.set(campaignId, (ch = new Map()));
    const others = [...ch.values()].filter((p) => p.peerId !== s.id);
    if (!ch.has(s.id) && ch.size >= MAX_VOICE_PEERS) throw new Error("full");
    const me: VoicePeer = { peerId: s.id, userId, name, muted: false };
    ch.set(s.id, me);
    void s.join(voiceRoom(campaignId));
    s.to(voiceRoom(campaignId)).emit("voice:peer-joined", { campaignId, peer: me });
    return { peers: others, self: s.id, iceServers: this.iceServers };
  }

  leave(s: Socket, campaignId: string) {
    const ch = this.channels.get(campaignId);
    if (!ch?.delete(s.id)) return;
    if (!ch.size) this.channels.delete(campaignId);
    void s.leave(voiceRoom(campaignId));
    this.io.to(voiceRoom(campaignId)).emit("voice:peer-left", { campaignId, peerId: s.id });
  }

  leaveAll(s: Socket) {
    for (const campaignId of [...this.channels.keys()]) this.leave(s, campaignId);
    this.buckets.delete(s.id);
  }

  setMuted(s: Socket, campaignId: string, muted: boolean) {
    const me = this.channels.get(campaignId)?.get(s.id);
    if (!me) return false;
    me.muted = muted;
    this.io.to(voiceRoom(campaignId)).emit("voice:peer-state", { campaignId, peerId: s.id, muted });
    return true;
  }

  /** Relays one signalling message between two peers in the same campaign's voice channel. */
  relay(s: Socket, input: z.infer<typeof signalSchema>): boolean {
    const ch = this.channels.get(input.campaignId);
    const from = ch?.get(s.id);
    if (!from || !ch?.has(input.to) || input.to === s.id) return false;
    if (!this.take(s.id)) return false;
    this.io.to(input.to).emit("voice:signal", { campaignId: input.campaignId, from: s.id, userId: from.userId, data: input.data });
    return true;
  }

  private take(id: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(id) ?? { tokens: 200, updated: now };
    b.tokens = Math.min(200, b.tokens + ((now - b.updated) / 1000) * 50);
    b.updated = now;
    this.buckets.set(id, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/** The subset of RTCIceServer we pass through (kept here so the server needs no DOM types). */
export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const iceSchema = z.array(z.object({ urls: z.union([z.string(), z.array(z.string())]), username: z.string().optional(), credential: z.string().optional() })).max(10);

/** Parses VOICE_ICE_SERVERS (JSON). Falls back to a public STUN server. */
export function iceServersFrom(json: string | undefined): RTCIceServerLike[] {
  const fallback = [{ urls: "stun:stun.l.google.com:19302" }];
  if (!json?.trim()) return fallback;
  try {
    const parsed = iceSchema.safeParse(JSON.parse(json));
    return parsed.success && parsed.data.length ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}
