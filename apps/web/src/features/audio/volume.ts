import { create } from "zustand";

/** The listener's own mix. Stored per browser; the DM can never change it. */
export interface VolumePrefs {
  master: number;
  music: number;
  ambient: number;
  sfx: number;
  muted: boolean;
}

const KEY = "vtt.volume";
export const DEFAULT_VOLUME: VolumePrefs = { master: 0.8, music: 1, ambient: 1, sfx: 1, muted: false };

export function parsePrefs(raw: string | null): VolumePrefs {
  if (!raw) return DEFAULT_VOLUME;
  try {
    const v = JSON.parse(raw) as Partial<VolumePrefs>;
    const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
    return {
      master: n(v.master, DEFAULT_VOLUME.master),
      music: n(v.music, 1),
      ambient: n(v.ambient, 1),
      sfx: n(v.sfx, 1),
      muted: v.muted === true,
    };
  } catch {
    return DEFAULT_VOLUME;
  }
}

function load(): VolumePrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_VOLUME;
  }
}

interface VolumeState extends VolumePrefs {
  set(patch: Partial<VolumePrefs>): void;
}

export const useVolume = create<VolumeState>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch);
    const { master, music, ambient, sfx, muted } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ master, music, ambient, sfx, muted }));
    } catch {
      /* storage unavailable */
    }
  },
}));
