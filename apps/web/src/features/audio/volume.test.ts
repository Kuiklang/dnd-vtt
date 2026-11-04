import { describe, expect, it } from "vitest";
import { DEFAULT_VOLUME, parsePrefs } from "./volume";
import { formatTime, positionNow } from "./useCampaignAudio";

describe("listener volume prefs", () => {
  it("falls back to defaults and clamps bad values", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_VOLUME);
    expect(parsePrefs("not json")).toEqual(DEFAULT_VOLUME);
    expect(parsePrefs(JSON.stringify({ master: 3, music: -1, ambient: "x", sfx: 0.25, muted: true }))).toEqual({ master: 1, music: 0, ambient: 1, sfx: 0.25, muted: true });
  });
  it("formats time and computes position with the server clock offset", () => {
    expect(formatTime(125.9)).toBe("2:05");
    expect(formatTime(null)).toBe("--:--");
    const music = { track: null, playing: true, offsetSec: 10, at: 1_000_000, volume: 1, loop: "off" as const };
    // Local clock is 2s behind the server.
    expect(positionNow(music, 2000, 1_003_000)).toBe(15);
    expect(positionNow({ ...music, playing: false }, 2000, 9_999_999)).toBe(10);
  });
});
