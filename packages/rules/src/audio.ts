/**
 * Shared audio playback model (Phase 6). The server owns the state; clients only
 * render it. Time is expressed in server milliseconds: a playing track's position
 * is `offsetSec + (now - at) / 1000`, so every client computes the same position
 * from one broadcast without per-second updates.
 */

export const AUDIO_CATEGORIES = ["music", "ambient", "sfx"] as const;
export type AudioCategory = (typeof AUDIO_CATEGORIES)[number];

export const MUSIC_LOOP_MODES = ["off", "track", "queue"] as const;
export type MusicLoopMode = (typeof MUSIC_LOOP_MODES)[number];

/** Most ambient layers playing at once (rain + fire + crowd ...). */
export const MAX_AMBIENT_LAYERS = 6;
/** Durations are reported by the uploader's browser; anything outside this is ignored. */
export const MAX_TRACK_SECONDS = 6 * 60 * 60;

export interface MusicState {
  /** Track ids in play order (already shuffled when shuffle is on). */
  queue: string[];
  index: number;
  playlistId: string | null;
  playing: boolean;
  /** Position in seconds at server time `at`. */
  offsetSec: number;
  at: number;
  /** DM-set channel volume, 0..1. Players scale it with their own volume. */
  volume: number;
  loop: MusicLoopMode;
  shuffle: boolean;
}

export interface AmbientLayer {
  id: string;
  trackId: string;
  volume: number;
  playing: boolean;
}

export interface AudioState {
  music: MusicState | null;
  ambient: AmbientLayer[];
  /** Bumped on every change, so clients can drop out-of-order broadcasts. */
  revision: number;
}

export const emptyAudioState = (): AudioState => ({ music: null, ambient: [], revision: 0 });

export type AudioAction =
  | { kind: "play"; trackIds: string[]; startIndex?: number; playlistId?: string | null; shuffle?: boolean }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "stop" }
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "seek"; position: number }
  | { kind: "musicVolume"; volume: number }
  | { kind: "loop"; loop: MusicLoopMode }
  | { kind: "ambientAdd"; trackId: string; volume?: number; layerId: string }
  | { kind: "ambientRemove"; layerId: string }
  | { kind: "ambientVolume"; layerId: string; volume: number }
  | { kind: "ambientToggle"; layerId: string; playing: boolean }
  | { kind: "stopAll" };

export interface AudioContext {
  now: number;
  /** Known durations in seconds; a missing entry means "unknown". */
  durations: ReadonlyMap<string, number | null>;
  rng?: () => number;
}

export class AudioActionError extends Error {}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

function usableDuration(ctx: AudioContext, trackId: string | undefined): number | null {
  if (!trackId) return null;
  const d = ctx.durations.get(trackId);
  return d && Number.isFinite(d) && d >= 0.5 && d <= MAX_TRACK_SECONDS ? d : null;
}

export function musicPosition(m: MusicState, now: number): number {
  return Math.max(0, m.offsetSec + (m.playing ? (now - m.at) / 1000 : 0));
}

export function currentTrackId(m: MusicState | null): string | null {
  return m ? (m.queue[m.index] ?? null) : null;
}

function shuffled<T>(items: T[], rng: () => number, first?: T): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (first !== undefined) {
    const at = out.indexOf(first);
    if (at > 0) [out[0], out[at]] = [out[at]!, out[0]!];
  }
  return out;
}

/**
 * Moves a playing queue past any tracks that have finished by `ctx.now`
 * (looping or stopping as configured). Tracks with unknown duration never
 * auto-advance; the DM skips them by hand.
 */
export function normalizeMusic(m: MusicState | null, ctx: AudioContext): MusicState | null {
  if (!m || !m.playing) return m;
  let index = m.index;
  let pos = musicPosition(m, ctx.now);
  for (let guard = 0; guard < 10_000; guard++) {
    const dur = usableDuration(ctx, m.queue[index]);
    if (dur === null || pos < dur) {
      if (index === m.index && guard === 0) return m;
      return { ...m, index, offsetSec: pos, at: ctx.now };
    }
    if (m.loop === "track") {
      pos %= dur;
      continue;
    }
    pos -= dur;
    index += 1;
    if (index >= m.queue.length) {
      if (m.loop === "queue" && m.queue.length > 0) index = 0;
      else return { ...m, index: 0, playing: false, offsetSec: 0, at: ctx.now };
    }
  }
  return { ...m, index, offsetSec: 0, at: ctx.now };
}

/** Server time at which `normalizeMusic` would next change something (null = never). */
export function nextMusicChangeAt(m: MusicState | null, ctx: AudioContext): number | null {
  if (!m || !m.playing || m.loop === "track") return null;
  const dur = usableDuration(ctx, m.queue[m.index]);
  if (dur === null) return null;
  return ctx.now + Math.max(0, dur - musicPosition(m, ctx.now)) * 1000;
}

/** Applies one DM control action. Pure: returns a new state with revision + 1. */
export function applyAudioAction(state: AudioState, action: AudioAction, ctx: AudioContext): AudioState {
  const now = ctx.now;
  const music = normalizeMusic(state.music, ctx);
  const bump = (patch: Partial<AudioState>): AudioState => ({ ...state, music, ...patch, revision: state.revision + 1 });
  const needMusic = (): MusicState => {
    if (!music || music.queue.length === 0) throw new AudioActionError("Nothing is queued");
    return music;
  };
  const layer = (id: string) => {
    const l = state.ambient.find((a) => a.id === id);
    if (!l) throw new AudioActionError("That ambient layer isn't playing");
    return l;
  };

  switch (action.kind) {
    case "play": {
      if (action.trackIds.length === 0) throw new AudioActionError("Pick at least one track");
      const start = Math.min(Math.max(0, action.startIndex ?? 0), action.trackIds.length - 1);
      const shuffle = action.shuffle ?? false;
      const queue = shuffle ? shuffled(action.trackIds, ctx.rng ?? Math.random, action.trackIds[start]) : action.trackIds;
      return bump({
        music: {
          queue,
          index: shuffle ? 0 : start,
          playlistId: action.playlistId ?? null,
          playing: true,
          offsetSec: 0,
          at: now,
          volume: music?.volume ?? 0.8,
          loop: music?.loop ?? (action.playlistId ? "queue" : "off"),
          shuffle,
        },
      });
    }
    case "pause": {
      const m = needMusic();
      if (!m.playing) return state;
      return bump({ music: { ...m, playing: false, offsetSec: musicPosition(m, now), at: now } });
    }
    case "resume": {
      const m = needMusic();
      if (m.playing) return state;
      return bump({ music: { ...m, playing: true, at: now } });
    }
    case "stop": {
      const m = needMusic();
      return bump({ music: { ...m, playing: false, offsetSec: 0, at: now } });
    }
    case "next":
    case "prev": {
      const m = needMusic();
      // "Previous" a few seconds into a track restarts it, like most players.
      if (action.kind === "prev" && musicPosition(m, now) > 3) return bump({ music: { ...m, offsetSec: 0, at: now } });
      let index = m.index + (action.kind === "next" ? 1 : -1);
      if (index >= m.queue.length) index = m.loop === "off" ? m.queue.length - 1 : 0;
      if (index < 0) index = m.loop === "off" ? 0 : m.queue.length - 1;
      return bump({ music: { ...m, index, offsetSec: 0, at: now, playing: true } });
    }
    case "seek": {
      const m = needMusic();
      const dur = usableDuration(ctx, m.queue[m.index]);
      const position = Math.max(0, Math.min(action.position, dur ?? MAX_TRACK_SECONDS));
      return bump({ music: { ...m, offsetSec: position, at: now } });
    }
    case "musicVolume": {
      const m = needMusic();
      return bump({ music: { ...m, volume: clamp01(action.volume) } });
    }
    case "loop": {
      const m = needMusic();
      return bump({ music: { ...m, loop: action.loop } });
    }
    case "ambientAdd": {
      if (state.ambient.length >= MAX_AMBIENT_LAYERS) throw new AudioActionError(`At most ${MAX_AMBIENT_LAYERS} ambient layers`);
      if (state.ambient.some((a) => a.trackId === action.trackId)) throw new AudioActionError("That sound is already playing");
      return bump({ ambient: [...state.ambient, { id: action.layerId, trackId: action.trackId, volume: clamp01(action.volume ?? 0.6), playing: true }] });
    }
    case "ambientRemove":
      layer(action.layerId);
      return bump({ ambient: state.ambient.filter((a) => a.id !== action.layerId) });
    case "ambientVolume":
      layer(action.layerId);
      return bump({ ambient: state.ambient.map((a) => (a.id === action.layerId ? { ...a, volume: clamp01(action.volume) } : a)) });
    case "ambientToggle":
      layer(action.layerId);
      return bump({ ambient: state.ambient.map((a) => (a.id === action.layerId ? { ...a, playing: action.playing } : a)) });
    case "stopAll":
      return bump({ music: music ? { ...music, playing: false, offsetSec: 0, at: now } : null, ambient: [] });
  }
}

/** Removes a deleted track from the queue and the ambient layers. */
export function removeTrackFromState(state: AudioState, trackId: string, ctx: AudioContext): AudioState {
  const inAmbient = state.ambient.some((a) => a.trackId === trackId);
  const music = normalizeMusic(state.music, ctx);
  if (!inAmbient && !music?.queue.includes(trackId)) return state;
  let nextMusic = music;
  if (music && music.queue.includes(trackId)) {
    const current = currentTrackId(music);
    const queue = music.queue.filter((id) => id !== trackId);
    if (queue.length === 0) nextMusic = null;
    else if (current === trackId) {
      nextMusic = { ...music, queue, index: Math.min(music.index, queue.length - 1), offsetSec: 0, at: ctx.now };
    } else {
      nextMusic = { ...music, queue, index: queue.indexOf(current!) };
    }
  }
  return { music: nextMusic, ambient: state.ambient.filter((a) => a.trackId !== trackId), revision: state.revision + 1 };
}

/**
 * Where the client's audio element should be for a playing track, with drift
 * tolerance: returns null when `currentTime` is close enough to leave alone.
 */
export function seekTarget(expected: number, currentTime: number, duration: number | null, loop: boolean, toleranceSec = 1.5): number | null {
  let target = expected;
  if (duration && duration > 0) target = loop ? expected % duration : Math.min(expected, duration);
  return Math.abs(target - currentTime) > toleranceSec ? target : null;
}

/**
 * Local volume a client applies: DM channel volume x the player's own channel and
 * master volume. Players can always turn audio down or mute it for themselves.
 */
export function effectiveVolume(dmVolume: number, channel: number, master: number, muted: boolean): number {
  if (muted) return 0;
  return clamp01(dmVolume) * clamp01(channel) * clamp01(master);
}
