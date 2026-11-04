import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AudioActionError,
  MAX_TRACK_SECONDS,
  applyAudioAction,
  currentTrackId,
  emptyAudioState,
  nextMusicChangeAt,
  normalizeMusic,
  removeTrackFromState,
  type AudioAction,
  type AudioCategory,
  type AudioContext,
  type AudioState,
  type Capability,
  type MusicLoopMode,
} from "@vtt/rules";
import type { Db } from "../db/client.js";
import { assets, audioTracks, campaignAudio, playlists, type AudioTrackRow, type PlaylistRow } from "../db/schema.js";
import { assetUrl } from "../assets/service.js";
import type { Membership } from "../campaigns/service.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";

export const MAX_TRACKS = 500;
export const MAX_PLAYLISTS = 100;
export const MAX_PLAYLIST_TRACKS = 200;

export interface AudioTrackDto {
  id: string;
  name: string;
  category: AudioCategory;
  tags: string[];
  durationSec: number | null;
  url: string;
  createdAt: string;
}

export interface PlaylistDto {
  id: string;
  name: string;
  trackIds: string[];
  version: number;
}

/** The part of a track every listener needs to play it. */
export interface PlayableTrack {
  id: string;
  name: string;
  url: string;
  durationSec: number | null;
}

/**
 * Per-viewer playback state. Players get only what is audible right now; the
 * queue, playlist and upcoming tracks stay with whoever controls the music.
 */
export interface AudioStateDto {
  revision: number;
  serverNow: number;
  canControl: boolean;
  music: {
    track: PlayableTrack | null;
    playing: boolean;
    offsetSec: number;
    at: number;
    volume: number;
    loop: MusicLoopMode;
    queue?: string[];
    index?: number;
    playlistId?: string | null;
    shuffle?: boolean;
  } | null;
  ambient: Array<{ id: string; track: PlayableTrack; volume: number; playing: boolean }>;
}

export const toTrackDto = (t: AudioTrackRow): AudioTrackDto => ({
  id: t.id,
  name: t.name,
  category: t.category,
  tags: t.tags,
  durationSec: t.durationSec,
  url: assetUrl(t.assetId),
  createdAt: t.createdAt.toISOString(),
});

const toPlaylistDto = (p: PlaylistRow): PlaylistDto => ({ id: p.id, name: p.name, trackIds: p.trackIds, version: p.version });
const playable = (t: AudioTrackRow): PlayableTrack => ({ id: t.id, name: t.name, url: assetUrl(t.assetId), durationSec: t.durationSec });

const validDuration = (d: number | null | undefined) => (d != null && Number.isFinite(d) && d > 0 && d <= MAX_TRACK_SECONDS ? d : null);

export interface TrackInput {
  assetId: string;
  name: string;
  category: AudioCategory;
  tags: string[];
  durationSec: number | null;
}

/** Everything the realtime layer needs to broadcast one change. */
export interface AudioSnapshot {
  state: AudioState;
  tracks: Map<string, AudioTrackRow>;
}

export function viewAudio(snap: AudioSnapshot, caps: ReadonlySet<Capability>, now: number): AudioStateDto {
  const canControl = caps.has("music.control");
  const { state, tracks } = snap;
  const m = state.music;
  const current = currentTrackId(m);
  const currentRow = current ? tracks.get(current) : undefined;
  return {
    revision: state.revision,
    serverNow: now,
    canControl,
    music: m
      ? {
          track: currentRow ? playable(currentRow) : null,
          playing: m.playing && !!currentRow,
          offsetSec: m.offsetSec,
          at: m.at,
          volume: m.volume,
          loop: m.loop,
          ...(canControl ? { queue: m.queue, index: m.index, playlistId: m.playlistId, shuffle: m.shuffle } : {}),
        }
      : null,
    ambient: state.ambient.flatMap((a) => {
      const row = tracks.get(a.trackId);
      return row ? [{ id: a.id, track: playable(row), volume: a.volume, playing: a.playing }] : [];
    }),
  };
}

export class AudioService {
  constructor(private readonly db: Db) {}

  private requireControl(m: Membership) {
    if (!m.caps.has("music.control")) throw forbidden("Only the DM can control the music");
  }

  // ---- Library ---------------------------------------------------------------

  async library(m: Membership): Promise<{ tracks: AudioTrackDto[]; playlists: PlaylistDto[] }> {
    this.requireControl(m);
    const [t, p] = await Promise.all([
      this.db.select().from(audioTracks).where(eq(audioTracks.campaignId, m.campaign.id)).orderBy(asc(audioTracks.category), asc(audioTracks.name)),
      this.db.select().from(playlists).where(eq(playlists.campaignId, m.campaign.id)).orderBy(asc(playlists.name)),
    ]);
    return { tracks: t.map(toTrackDto), playlists: p.map(toPlaylistDto) };
  }

  private async trackRow(campaignId: string, id: string): Promise<AudioTrackRow> {
    const [row] = await this.db.select().from(audioTracks).where(and(eq(audioTracks.id, id), eq(audioTracks.campaignId, campaignId)));
    if (!row) throw notFound("Track");
    return row;
  }

  async createTrack(m: Membership, input: TrackInput): Promise<AudioTrackDto> {
    this.requireControl(m);
    const [asset] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, input.assetId), eq(assets.campaignId, m.campaign.id), isNull(assets.deletedAt)));
    if (!asset || asset.kind !== "audio") throw badRequest("Upload an audio file to this campaign first");
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(audioTracks)
      .where(eq(audioTracks.campaignId, m.campaign.id));
    if (n >= MAX_TRACKS) throw badRequest(`A campaign can hold at most ${MAX_TRACKS} sounds`);
    const [row] = await this.db
      .insert(audioTracks)
      .values({
        campaignId: m.campaign.id,
        assetId: asset.id,
        name: input.name,
        category: input.category,
        tags: [...new Set(input.tags)],
        durationSec: validDuration(input.durationSec),
        createdBy: m.member.userId,
      })
      .returning();
    return toTrackDto(row!);
  }

  async updateTrack(m: Membership, id: string, patch: Partial<Omit<TrackInput, "assetId">>): Promise<AudioTrackDto> {
    this.requireControl(m);
    await this.trackRow(m.campaign.id, id);
    const [row] = await this.db
      .update(audioTracks)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.tags !== undefined ? { tags: [...new Set(patch.tags)] } : {}),
        ...(patch.durationSec !== undefined ? { durationSec: validDuration(patch.durationSec) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(audioTracks.id, id))
      .returning();
    return toTrackDto(row!);
  }

  /** Deletes the track and its file, and takes it out of playlists and of whatever is playing. */
  async deleteTrack(m: Membership, id: string): Promise<void> {
    this.requireControl(m);
    const row = await this.trackRow(m.campaign.id, id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(playlists)
        .set({ trackIds: sql`array_remove(${playlists.trackIds}, ${id}::uuid)`, version: sql`${playlists.version} + 1`, updatedAt: new Date() })
        .where(and(eq(playlists.campaignId, m.campaign.id), sql`${id}::uuid = any(${playlists.trackIds})`));
      await tx.delete(audioTracks).where(eq(audioTracks.id, id));
      await tx.update(assets).set({ deletedAt: new Date() }).where(eq(assets.id, row.assetId));
    });
    await this.mutate(m.campaign.id, (state, ctx) => removeTrackFromState(state, id, ctx));
  }

  // ---- Playlists -------------------------------------------------------------

  private async checkTrackIds(campaignId: string, ids: string[]) {
    if (ids.length > MAX_PLAYLIST_TRACKS) throw badRequest(`A playlist can hold at most ${MAX_PLAYLIST_TRACKS} tracks`);
    if (ids.length === 0) return;
    const found = await this.db
      .select({ id: audioTracks.id })
      .from(audioTracks)
      .where(and(eq(audioTracks.campaignId, campaignId), inArray(audioTracks.id, [...new Set(ids)])));
    if (found.length !== new Set(ids).size) throw badRequest("A playlist can only contain this campaign's sounds");
  }

  async createPlaylist(m: Membership, input: { name: string; trackIds: string[] }): Promise<PlaylistDto> {
    this.requireControl(m);
    await this.checkTrackIds(m.campaign.id, input.trackIds);
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(playlists)
      .where(eq(playlists.campaignId, m.campaign.id));
    if (n >= MAX_PLAYLISTS) throw badRequest(`A campaign can hold at most ${MAX_PLAYLISTS} playlists`);
    const [row] = await this.db.insert(playlists).values({ campaignId: m.campaign.id, ...input }).returning();
    return toPlaylistDto(row!);
  }

  private async playlistRow(campaignId: string, id: string): Promise<PlaylistRow> {
    const [row] = await this.db.select().from(playlists).where(and(eq(playlists.id, id), eq(playlists.campaignId, campaignId)));
    if (!row) throw notFound("Playlist");
    return row;
  }

  async updatePlaylist(m: Membership, id: string, expectedVersion: number, patch: { name?: string; trackIds?: string[] }): Promise<PlaylistDto> {
    this.requireControl(m);
    await this.playlistRow(m.campaign.id, id);
    if (patch.trackIds) await this.checkTrackIds(m.campaign.id, patch.trackIds);
    const [row] = await this.db
      .update(playlists)
      .set({ ...patch, version: sql`${playlists.version} + 1`, updatedAt: new Date() })
      .where(and(eq(playlists.id, id), eq(playlists.version, expectedVersion)))
      .returning();
    if (!row) throw conflict("Someone else changed this playlist. Reload and try again.");
    return toPlaylistDto(row);
  }

  async deletePlaylist(m: Membership, id: string): Promise<void> {
    this.requireControl(m);
    await this.playlistRow(m.campaign.id, id);
    await this.db.delete(playlists).where(eq(playlists.id, id));
  }

  // ---- Playback state -------------------------------------------------------

  private async tracksFor(campaignId: string, state: AudioState): Promise<Map<string, AudioTrackRow>> {
    const ids = new Set([...(state.music?.queue ?? []), ...state.ambient.map((a) => a.trackId)]);
    if (ids.size === 0) return new Map();
    const rows = await this.db
      .select()
      .from(audioTracks)
      .where(and(eq(audioTracks.campaignId, campaignId), inArray(audioTracks.id, [...ids])));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private ctx(tracks: Map<string, AudioTrackRow>, now = Date.now()): AudioContext {
    return { now, durations: new Map([...tracks].map(([id, t]) => [id, t.durationSec])) };
  }

  /** Current state, with finished tracks advanced (and saved, so every listener agrees). */
  async snapshot(campaignId: string): Promise<AudioSnapshot> {
    const [row] = await this.db.select().from(campaignAudio).where(eq(campaignAudio.campaignId, campaignId));
    const state = row?.state ?? emptyAudioState();
    const tracks = await this.tracksFor(campaignId, state);
    const music = normalizeMusic(state.music, this.ctx(tracks));
    if (music === state.music) return { state, tracks };
    // Something finished: persist under a lock so concurrent readers don't double-advance.
    return this.mutate(campaignId, (s) => s);
  }

  /**
   * Read-modify-write of the campaign's playback state under a row lock. `fn`
   * may return the same object to mean "no change" (only normalisation is saved).
   */
  private async mutate(campaignId: string, fn: (state: AudioState, ctx: AudioContext) => AudioState): Promise<AudioSnapshot> {
    return this.db.transaction(async (tx) => {
      await tx.insert(campaignAudio).values({ campaignId, state: emptyAudioState() }).onConflictDoNothing();
      const [row] = await tx.select().from(campaignAudio).where(eq(campaignAudio.campaignId, campaignId)).for("update");
      const before = row!.state;
      const tracks = await this.tracksFor(campaignId, before);
      const ctx = this.ctx(tracks);
      const normalized = normalizeMusic(before.music, ctx);
      const base = normalized === before.music ? before : { ...before, music: normalized, revision: before.revision + 1 };
      let next: AudioState;
      try {
        next = fn(base, ctx);
      } catch (e) {
        if (e instanceof AudioActionError) throw badRequest(e.message);
        throw e;
      }
      if (next !== before) {
        await tx.update(campaignAudio).set({ state: next, updatedAt: new Date() }).where(eq(campaignAudio.campaignId, campaignId));
      }
      // New tracks (e.g. a playlist just started) need their rows for the broadcast.
      return { state: next, tracks: next === base ? tracks : await this.tracksFor(campaignId, next) };
    });
  }

  /** Resolves a DM's request into a model action (playlists and tracks are checked here). */
  async control(m: Membership, req: ControlRequest): Promise<AudioSnapshot> {
    this.requireControl(m);
    const campaignId = m.campaign.id;
    let action: AudioAction;
    switch (req.kind) {
      case "playTrack": {
        const t = await this.trackRow(campaignId, req.trackId);
        action = { kind: "play", trackIds: [t.id] };
        break;
      }
      case "playPlaylist": {
        const p = await this.playlistRow(campaignId, req.playlistId);
        if (p.trackIds.length === 0) throw badRequest("That playlist is empty");
        const start = req.trackId ? p.trackIds.indexOf(req.trackId) : 0;
        if (start < 0) throw badRequest("That track isn't in the playlist");
        action = { kind: "play", trackIds: p.trackIds, startIndex: start, playlistId: p.id, shuffle: req.shuffle };
        break;
      }
      case "ambientAdd": {
        const t = await this.trackRow(campaignId, req.trackId);
        action = { kind: "ambientAdd", trackId: t.id, volume: req.volume, layerId: randomUUID() };
        break;
      }
      default:
        action = req;
    }
    return this.mutate(campaignId, (state, ctx) => applyAudioAction(state, action, ctx));
  }

  /**
   * Starts a scene's music unless it's already what's playing (so re-showing a
   * scene doesn't restart its song). Missing tracks/playlists are ignored.
   */
  async startSceneMusic(m: Membership, music: { kind: "playlist" | "track"; id: string }): Promise<AudioSnapshot | null> {
    const current = await this.snapshot(m.campaign.id);
    const cm = current.state.music;
    if (cm?.playing) {
      if (music.kind === "playlist" && cm.playlistId === music.id) return null;
      if (music.kind === "track" && currentTrackId(cm) === music.id && !cm.playlistId) return null;
    }
    try {
      return await this.control(m, music.kind === "playlist" ? { kind: "playPlaylist", playlistId: music.id } : { kind: "playTrack", trackId: music.id });
    } catch {
      return null;
    }
  }

  /** A one-shot sound effect. Not persisted: whoever is connected hears it once. */
  async sfx(m: Membership, trackId: string): Promise<PlayableTrack> {
    this.requireControl(m);
    return playable(await this.trackRow(m.campaign.id, trackId));
  }

  /** When the server should next re-check this campaign (end of the current track). */
  nextChangeAt(snap: AudioSnapshot, now = Date.now()): number | null {
    return nextMusicChangeAt(snap.state.music, this.ctx(snap.tracks, now));
  }
}

export type ControlRequest =
  | { kind: "playTrack"; trackId: string }
  | { kind: "playPlaylist"; playlistId: string; trackId?: string; shuffle?: boolean }
  | { kind: "ambientAdd"; trackId: string; volume?: number }
  | Exclude<AudioAction, { kind: "play" } | { kind: "ambientAdd" }>;
