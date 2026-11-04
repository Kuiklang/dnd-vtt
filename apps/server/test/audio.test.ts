import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { sniffAudio } from "../src/assets/service.js";
import { parseRange } from "../src/assets/routes.js";
import { createCampaign, pngBytes, registerUser, setupApp, upload, wavBytes } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await setupApp();
  await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = ctx.app.server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.close();
});

function open(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { extraHeaders: { cookie }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
const emit = (s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: any; error?: string; code?: string }> =>
  new Promise((resolve) => s.emit(event, payload, resolve));
function collect(s: Socket, event: string) {
  const items: any[] = [];
  s.on(event, (p) => items.push(p));
  return items;
}
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function table() {
  const dm = await registerUser(ctx.app);
  const { id, code } = await createCampaign(dm.client, { rulesetId: "dnd5e-2014" });
  const alice = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  return { id, dm, alice };
}

async function addTrack(c: Awaited<ReturnType<typeof registerUser>>["client"], campaignId: string, name: string, extra: Record<string, unknown> = {}) {
  const res = await upload(ctx.app, c, { kind: "audio", campaignId }, wavBytes(0.5), `${name}.wav`);
  expect(res.statusCode).toBe(201);
  const assetId = res.json().asset.id;
  const t = await c.post(`/api/campaigns/${campaignId}/audio/tracks`, { assetId, name, ...extra });
  expect(t.statusCode).toBe(201);
  return t.json().track;
}

describe("audio uploads", () => {
  it("sniffs audio containers from magic bytes", () => {
    expect(sniffAudio(wavBytes(0.1))).toBe("audio/wav");
    expect(sniffAudio(Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00", "binary"))).toBe("audio/mpeg");
    expect(sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("audio/mpeg");
    expect(sniffAudio(Buffer.from("OggS\x00\x02\x00\x00\x00\x00\x00\x00", "binary"))).toBe("audio/ogg");
    expect(sniffAudio(Buffer.from("\x00\x00\x00\x20ftypM4A \x00\x00", "binary"))).toBe("audio/mp4");
    expect(sniffAudio(Buffer.from("<html><script>x</script>"))).toBeNull();
    expect(sniffAudio(pngBytes(4, 4))).toBeNull();
  });

  it("parses byte ranges", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });

  it("only lets the DM upload sounds, rejects non-audio, and streams byte ranges", async () => {
    const { id, dm, alice } = await table();
    const wav = wavBytes(0.5);
    expect((await upload(ctx.app, alice.client, { kind: "audio", campaignId: id }, wav, "a.wav")).statusCode).toBe(403);
    expect((await upload(ctx.app, dm.client, { kind: "audio", campaignId: id }, Buffer.from("<html>not audio at all</html>"), "evil.mp3")).statusCode).toBe(400);
    expect((await upload(ctx.app, dm.client, { kind: "audio", campaignId: id }, pngBytes(8, 8), "pic.mp3")).statusCode).toBe(400);
    expect((await upload(ctx.app, dm.client, { kind: "audio" }, wav, "a.wav")).statusCode).toBe(400);
    const res = await upload(ctx.app, dm.client, { kind: "audio", campaignId: id }, wav, "rain.wav");
    expect(res.statusCode).toBe(201);
    const asset = res.json().asset;
    expect(asset.mime).toBe("audio/wav");

    // Players can stream it (they need to hear it) but don't see it listed.
    const part = await ctx.app.inject({ method: "GET", url: asset.url, headers: { cookie: alice.client.cookie, range: "bytes=0-11" } });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-11/${wav.length}`);
    expect(part.rawPayload.toString("ascii", 8, 12)).toBe("WAVE");
    const whole = await ctx.app.inject({ method: "GET", url: asset.url, headers: { cookie: alice.client.cookie } });
    expect(whole.statusCode).toBe(200);
    expect(whole.headers["accept-ranges"]).toBe("bytes");
    expect(whole.rawPayload.length).toBe(wav.length);
    const bad = await ctx.app.inject({ method: "GET", url: asset.url, headers: { cookie: alice.client.cookie, range: `bytes=${wav.length}-` } });
    expect(bad.statusCode).toBe(416);
    expect(((await alice.client.get(`/api/campaigns/${id}/assets`)).json().assets as any[]).some((a) => a.kind === "audio")).toBe(false);
    expect(((await dm.client.get(`/api/campaigns/${id}/assets`)).json().assets as any[]).some((a) => a.kind === "audio")).toBe(true);
  });
});

describe("music library", () => {
  it("keeps tracks and playlists DM-only and validates them", async () => {
    const { id, dm, alice } = await table();
    const base = `/api/campaigns/${id}/audio`;
    const a = await addTrack(dm.client, id, "Tavern", { category: "music", tags: ["town", "town", "calm"], durationSec: 95.5 });
    const b = await addTrack(dm.client, id, "Rain", { category: "ambient" });
    expect((await dm.client.post(`${base}/tracks`, { assetId: a.id, name: "neg", durationSec: -3 })).statusCode).toBe(400);
    expect(a.tags).toEqual(["town", "calm"]);
    expect((await dm.client.post(`${base}/tracks`, { assetId: a.id, name: "x" })).statusCode).toBe(400);
    expect((await alice.client.get(base)).statusCode).toBe(403);
    expect((await alice.client.post(`${base}/playlists`, { name: "Mine" })).statusCode).toBe(403);

    const other = await table();
    const foreign = await addTrack(other.dm.client, other.id, "Elsewhere");
    expect((await dm.client.post(`${base}/playlists`, { name: "Bad", trackIds: [foreign.id] })).statusCode).toBe(400);
    const p = (await dm.client.post(`${base}/playlists`, { name: "Town", trackIds: [a.id, b.id] })).json().playlist;
    expect((await dm.client.put(`${base}/playlists/${p.id}`, { expectedVersion: 1, name: "Town night" })).statusCode).toBe(200);
    expect((await dm.client.put(`${base}/playlists/${p.id}`, { expectedVersion: 1, name: "Stale" })).statusCode).toBe(409);

    const lib = (await dm.client.get(base)).json();
    expect(lib.tracks.map((t: any) => t.name).sort()).toEqual(["Rain", "Tavern"]);
    expect(lib.tracks.find((t: any) => t.name === "Rain").durationSec).toBeNull();

    // Deleting a track removes it from playlists and deletes its file.
    expect((await dm.client.del(`${base}/tracks/${a.id}`)).statusCode).toBe(200);
    expect((await dm.client.get(base)).json().playlists[0].trackIds).toEqual([b.id]);
    expect((await dm.client.get(a.url)).statusCode).toBe(404);
  });
});

describe("live playback", () => {
  it("syncs DM controls to players, hides the queue, and plays sound effects", async () => {
    const { id, dm, alice } = await table();
    const t1 = await addTrack(dm.client, id, "Battle", { durationSec: 120 });
    const t2 = await addTrack(dm.client, id, "Boss reveal", { durationSec: 90 });
    const rain = await addTrack(dm.client, id, "Rain", { category: "ambient" });
    const boom = await addTrack(dm.client, id, "Thunder", { category: "sfx" });
    const p = (await dm.client.post(`/api/campaigns/${id}/audio/playlists`, { name: "Combat", trackIds: [t1.id, t2.id] })).json().playlist;

    const ds = await open(dm.client.cookie);
    const as = await open(alice.client.cookie);
    const join = await emit(as, "campaign:join", { campaignId: id });
    expect(join.data.audio).toMatchObject({ music: null, ambient: [], canControl: false });
    await emit(ds, "campaign:join", { campaignId: id });
    const aliceStates = collect(as, "audio:state");
    const aliceSfx = collect(as, "audio:sfx");

    // Players can't control anything.
    const denied = await emit(as, "audio:control", { campaignId: id, action: { kind: "playTrack", trackId: t1.id } });
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });
    expect((await emit(as, "audio:sfx", { campaignId: id, trackId: boom.id })).ok).toBe(false);

    const started = await emit(ds, "audio:control", { campaignId: id, action: { kind: "playPlaylist", playlistId: p.id } });
    expect(started.ok).toBe(true);
    expect(started.data.music).toMatchObject({ playing: true, queue: [t1.id, t2.id], index: 0, playlistId: p.id, loop: "queue" });
    await tick();
    const view = aliceStates.at(-1).audio;
    expect(view.music.track).toMatchObject({ id: t1.id, name: "Battle", url: t1.url, durationSec: 120 });
    expect(view.music.playing).toBe(true);
    expect(view.music).not.toHaveProperty("queue");
    expect(view.music).not.toHaveProperty("playlistId");
    expect(Math.abs(view.serverNow - Date.now())).toBeLessThan(2000);

    await emit(ds, "audio:control", { campaignId: id, action: { kind: "pause" } });
    await emit(ds, "audio:control", { campaignId: id, action: { kind: "next" } });
    await emit(ds, "audio:control", { campaignId: id, action: { kind: "musicVolume", volume: 0.4 } });
    const amb = await emit(ds, "audio:control", { campaignId: id, action: { kind: "ambientAdd", trackId: rain.id, volume: 0.3 } });
    expect(amb.data.ambient).toHaveLength(1);
    expect((await emit(ds, "audio:control", { campaignId: id, action: { kind: "ambientAdd", trackId: rain.id } })).error).toMatch(/already/);
    await emit(ds, "audio:sfx", { campaignId: id, trackId: boom.id, volume: 0.9 });
    await tick();
    const last = aliceStates.at(-1).audio;
    expect(last.music).toMatchObject({ playing: true, volume: 0.4, track: { id: t2.id } });
    expect(last.ambient).toEqual([{ id: amb.data.ambient[0].id, track: expect.objectContaining({ id: rain.id, name: "Rain" }), volume: 0.3, playing: true }]);
    expect(aliceSfx).toEqual([{ campaignId: id, track: expect.objectContaining({ id: boom.id }), volume: 0.9 }]);
    expect(aliceStates.map((s) => s.audio.revision)).toEqual([...aliceStates.map((s) => s.audio.revision)].sort((x, y) => x - y));

    // A late joiner (or reload) gets the same state.
    const sync = await emit(as, "audio:sync", { campaignId: id });
    expect(sync.data.revision).toBe(last.revision);

    // Deleting a playing ambient sound stops it for everyone.
    await dm.client.del(`/api/campaigns/${id}/audio/tracks/${rain.id}`);
    await tick();
    expect(aliceStates.at(-1).audio.ambient).toEqual([]);

    await emit(ds, "audio:control", { campaignId: id, action: { kind: "stopAll" } });
    await tick();
    expect(aliceStates.at(-1).audio.music.playing).toBe(false);
  });

  it("advances to the next track on the server when one ends, then stops", async () => {
    const { id, dm, alice } = await table();
    const t1 = await addTrack(dm.client, id, "Short one", { durationSec: 0.6 });
    const t2 = await addTrack(dm.client, id, "Short two", { durationSec: 0.6 });
    const p = (await dm.client.post(`/api/campaigns/${id}/audio/playlists`, { name: "Quick", trackIds: [t1.id, t2.id] })).json().playlist;
    const ds = await open(dm.client.cookie);
    const as = await open(alice.client.cookie);
    await emit(ds, "campaign:join", { campaignId: id });
    await emit(as, "campaign:join", { campaignId: id });
    const states = collect(as, "audio:state");
    await emit(ds, "audio:control", { campaignId: id, action: { kind: "playPlaylist", playlistId: p.id } });
    await emit(ds, "audio:control", { campaignId: id, action: { kind: "loop", loop: "off" } });
    await tick(1100);
    expect(states.at(-1).audio.music).toMatchObject({ playing: true, track: { id: t2.id } });
    await tick(800);
    expect(states.at(-1).audio.music.playing).toBe(false);
  });
});
