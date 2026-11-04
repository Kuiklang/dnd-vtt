import { describe, expect, it } from "vitest";
import {
  applyAudioAction,
  effectiveVolume,
  emptyAudioState,
  musicPosition,
  nextMusicChangeAt,
  normalizeMusic,
  removeTrackFromState,
  seekTarget,
  AudioActionError,
  type AudioState,
} from "../src/audio.js";

const durations = new Map<string, number | null>([
  ["a", 100],
  ["b", 50],
  ["c", null],
]);
const at = (now: number) => ({ now, durations });

function playing(loop: "off" | "track" | "queue" = "off", queue = ["a", "b"]): AudioState {
  const s = applyAudioAction(emptyAudioState(), { kind: "play", trackIds: queue }, at(0));
  return applyAudioAction(s, { kind: "loop", loop }, at(0));
}

describe("audio playback model", () => {
  it("computes position from server time and pauses/resumes exactly", () => {
    let s = playing();
    expect(musicPosition(s.music!, 10_000)).toBe(10);
    s = applyAudioAction(s, { kind: "pause" }, at(10_000));
    expect(s.music!.playing).toBe(false);
    expect(musicPosition(s.music!, 99_000)).toBe(10);
    s = applyAudioAction(s, { kind: "resume" }, at(20_000));
    expect(musicPosition(s.music!, 25_000)).toBe(15);
    expect(s.revision).toBe(4);
  });

  it("advances through the queue and stops at the end when not looping", () => {
    const s = playing("off");
    const m = normalizeMusic(s.music, at(120_000))!;
    expect(m.index).toBe(1);
    expect(musicPosition(m, 120_000)).toBe(20);
    const done = normalizeMusic(s.music, at(151_000))!;
    expect(done.playing).toBe(false);
    expect(done.index).toBe(0);
  });

  it("wraps a looping queue and repeats a looping track", () => {
    const q = normalizeMusic(playing("queue").music, at(160_000))!;
    expect(q.index).toBe(0);
    expect(musicPosition(q, 160_000)).toBe(10);
    const t = normalizeMusic(playing("track").music, at(250_000))!;
    expect(t.index).toBe(0);
    expect(musicPosition(t, 250_000)).toBe(50);
  });

  it("never auto-advances a track of unknown length", () => {
    const s = playing("off", ["c", "a"]);
    expect(normalizeMusic(s.music, at(9_999_000))).toBe(s.music);
    expect(nextMusicChangeAt(s.music, at(0))).toBeNull();
  });

  it("schedules the next change at the end of the current track", () => {
    const s = playing("off");
    expect(nextMusicChangeAt(s.music, at(40_000))).toBe(100_000);
    expect(nextMusicChangeAt(playing("track").music, at(0))).toBeNull();
  });

  it("next/prev respect loop mode; prev restarts a track after 3 seconds", () => {
    let s = playing("off");
    s = applyAudioAction(s, { kind: "next" }, at(1000));
    expect(s.music!.index).toBe(1);
    s = applyAudioAction(s, { kind: "next" }, at(2000));
    expect(s.music!.index).toBe(1);
    s = applyAudioAction(s, { kind: "prev" }, at(10_000));
    expect(s.music!.index).toBe(1);
    expect(musicPosition(s.music!, 10_000)).toBe(0);
    s = applyAudioAction(s, { kind: "prev" }, at(11_000));
    expect(s.music!.index).toBe(0);
    const looped = applyAudioAction(playing("queue"), { kind: "prev" }, at(1000));
    expect(looped.music!.index).toBe(1);
  });

  it("shuffle keeps the chosen track first and every track once", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const s = applyAudioAction(emptyAudioState(), { kind: "play", trackIds: ids, startIndex: 3, shuffle: true }, { ...at(0), rng: () => 0.3 });
    expect(s.music!.queue[0]).toBe("d");
    expect([...s.music!.queue].sort()).toEqual(ids);
    expect(s.music!.index).toBe(0);
  });

  it("clamps seek and volumes", () => {
    let s = playing();
    s = applyAudioAction(s, { kind: "seek", position: 500 }, at(0));
    expect(s.music!.offsetSec).toBe(100);
    s = applyAudioAction(s, { kind: "musicVolume", volume: 7 }, at(0));
    expect(s.music!.volume).toBe(1);
  });

  it("manages ambient layers with a cap and no duplicates", () => {
    let s = emptyAudioState();
    for (let i = 0; i < 6; i++) s = applyAudioAction(s, { kind: "ambientAdd", trackId: `t${i}`, layerId: `l${i}` }, at(0));
    expect(() => applyAudioAction(s, { kind: "ambientAdd", trackId: "x", layerId: "lx" }, at(0))).toThrow(AudioActionError);
    expect(() => applyAudioAction(emptyAudioState(), { kind: "pause" }, at(0))).toThrow(AudioActionError);
    s = applyAudioAction(s, { kind: "ambientVolume", layerId: "l1", volume: 0.2 }, at(0));
    s = applyAudioAction(s, { kind: "ambientToggle", layerId: "l2", playing: false }, at(0));
    s = applyAudioAction(s, { kind: "ambientRemove", layerId: "l0" }, at(0));
    expect(s.ambient.map((a) => [a.id, a.volume, a.playing])).toEqual([
      ["l1", 0.2, true],
      ["l2", 0.6, false],
      ["l3", 0.6, true],
      ["l4", 0.6, true],
      ["l5", 0.6, true],
    ]);
    const dup = applyAudioAction(emptyAudioState(), { kind: "ambientAdd", trackId: "t", layerId: "1" }, at(0));
    expect(() => applyAudioAction(dup, { kind: "ambientAdd", trackId: "t", layerId: "2" }, at(0))).toThrow(/already/);
  });

  it("stopAll silences music and clears ambience", () => {
    let s = applyAudioAction(playing(), { kind: "ambientAdd", trackId: "b", layerId: "l" }, at(0));
    s = applyAudioAction(s, { kind: "stopAll" }, at(5000));
    expect(s.music!.playing).toBe(false);
    expect(s.ambient).toEqual([]);
  });

  it("removes a deleted track from queue and layers", () => {
    let s = applyAudioAction(playing("off", ["a", "b", "c"]), { kind: "next" }, at(0));
    s = applyAudioAction(s, { kind: "ambientAdd", trackId: "a", layerId: "l" }, at(0));
    const r = removeTrackFromState(s, "a", at(1000));
    expect(r.music!.queue).toEqual(["b", "c"]);
    expect(r.music!.index).toBe(0);
    expect(r.ambient).toEqual([]);
    const current = removeTrackFromState(r, "b", at(2000));
    expect(current.music!.queue).toEqual(["c"]);
    expect(musicPosition(current.music!, 2000)).toBe(0);
    expect(removeTrackFromState(current, "zzz", at(0))).toBe(current);
    expect(removeTrackFromState(current, "c", at(0)).music).toBeNull();
  });

  it("seekTarget tolerates small drift and wraps looping tracks", () => {
    expect(seekTarget(10, 9.5, 100, false)).toBeNull();
    expect(seekTarget(10, 3, 100, false)).toBe(10);
    expect(seekTarget(250, 0, 100, true)).toBe(50);
    expect(seekTarget(250, 0, 100, false)).toBe(100);
  });

  it("player volume scales DM volume and mute wins", () => {
    expect(effectiveVolume(0.8, 0.5, 0.5, false)).toBeCloseTo(0.2);
    expect(effectiveVolume(1, 1, 1, true)).toBe(0);
  });
});
