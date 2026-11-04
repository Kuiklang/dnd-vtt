import type { AudioCategory, MusicLoopMode } from "@vtt/rules";

export interface AudioTrack {
  id: string;
  name: string;
  category: AudioCategory;
  tags: string[];
  durationSec: number | null;
  url: string;
  createdAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  version: number;
}

export interface PlayableTrack {
  id: string;
  name: string;
  url: string;
  durationSec: number | null;
}

/** Mirrors the server's per-viewer AudioStateDto (queue fields only for controllers). */
export interface AudioView {
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

export type ControlAction =
  | { kind: "playTrack"; trackId: string }
  | { kind: "playPlaylist"; playlistId: string; trackId?: string; shuffle?: boolean }
  | { kind: "pause" | "resume" | "stop" | "next" | "prev" | "stopAll" }
  | { kind: "seek"; position: number }
  | { kind: "musicVolume"; volume: number }
  | { kind: "loop"; loop: MusicLoopMode }
  | { kind: "ambientAdd"; trackId: string; volume?: number }
  | { kind: "ambientRemove"; layerId: string }
  | { kind: "ambientVolume"; layerId: string; volume: number }
  | { kind: "ambientToggle"; layerId: string; playing: boolean };
