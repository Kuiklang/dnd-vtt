import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createCampaign, registerUser, setupApp } from "./helpers.js";

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
const next = (s: Socket, event: string) => new Promise<any>((resolve) => s.once(event, resolve));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** DM + one player on a 1000×1000 map (70 px cells, 5 ft) with a wall down the middle. */
async function visionTable() {
  const dm = await registerUser(ctx.app);
  const { id, code } = await createCampaign(dm.client, { rulesetId: "dnd5e-2014" });
  const alice = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  const scene = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Crypt", width: 1000, height: 1000 })).json().scene;
  const ds = await open(dm.client.cookie);
  const as = await open(alice.client.cookie);
  const ref = { campaignId: id, sceneId: scene.id };
  await emit(ds, "campaign:join", { campaignId: id });
  await emit(as, "campaign:join", { campaignId: id });
  expect((await emit(ds, "scene:join", ref)).ok).toBe(true);
  const hero = (await emit(ds, "token:create", { ...ref, token: { name: "Hero", x: 100, y: 500, ownerIds: [alice.user.id] } })).data;
  const goblin = (await emit(ds, "token:create", { ...ref, token: { name: "Goblin", x: 800, y: 500 } })).data;
  const wall = (await emit(ds, "wall:add", { ...ref, walls: [{ x1: 500, y1: 0, x2: 500, y2: 1000 }], kind: "door" })).data.walls[0];
  return { id, dm, alice, ds, as, ref, scene, hero, goblin, wall };
}

const names = (tokens: Array<{ name: string }>) => tokens.map((t) => t.name).sort();

describe("dynamic vision", () => {
  it("only sends players the tokens their own tokens can see", async () => {
    const { dm, alice, as, ds, ref, scene } = await visionTable();
    // Vision off: the player sees the goblin across the closed door.
    expect(names((await emit(as, "scene:join", ref)).data.tokens)).toEqual(["Goblin", "Hero"]);

    const state = next(as, "scene:state");
    await dm.client.patch(`/api/campaigns/${ref.campaignId}/scenes/${scene.id}`, { vision: { enabled: true, ambient: "bright" } });
    const s = await state;
    expect(s.scene.vision).toEqual({ enabled: true, ambient: "bright" });
    expect(names(s.tokens)).toEqual(["Hero"]);
    expect(s.walls).toHaveLength(1);
    // The DM still sees everything.
    expect(names((await emit(ds, "scene:join", ref)).data.tokens)).toEqual(["Goblin", "Hero"]);
    void alice;
  });

  it("opens doors for players who can see them, and moving into view sends the token", async () => {
    const { dm, as, ds, ref, scene, hero, wall } = await visionTable();
    await dm.client.patch(`/api/campaigns/${ref.campaignId}/scenes/${scene.id}`, { vision: { enabled: true, ambient: "bright" } });
    await emit(as, "scene:join", ref);

    const opened = next(as, "scene:state");
    expect((await emit(as, "door:toggle", { ...ref, wallId: wall.id })).data).toEqual({ open: true });
    expect(names((await opened).tokens)).toEqual(["Goblin", "Hero"]);

    // Locked doors are DM-only.
    await emit(ds, "door:toggle", { ...ref, wallId: wall.id });
    await emit(ds, "wall:update", { ...ref, wallId: wall.id, patch: { locked: true } });
    const locked = await emit(as, "door:toggle", { ...ref, wallId: wall.id });
    expect(locked.ok).toBe(false);
    expect(locked.error).toMatch(/locked/);

    // Walls are DM-only.
    expect((await emit(as, "wall:add", { ...ref, walls: [{ x1: 0, y1: 0, x2: 100, y2: 0 }] })).ok).toBe(false);

    // Walk around the end of a shorter wall: the goblin comes into view.
    await emit(ds, "wall:delete", { ...ref, wallIds: "all" });
    await emit(ds, "wall:add", { ...ref, walls: [{ x1: 500, y1: 200, x2: 500, y2: 800 }] });
    await wait(50);
    const before = (await emit(as, "scene:join", ref)).data.tokens;
    expect(names(before)).toEqual(["Hero"]);
    const synced = next(as, "scene:tokens");
    expect((await emit(as, "token:update", { ...ref, tokenId: hero.id, patch: { x: 450, y: 980 } })).ok).toBe(true);
    expect(names((await synced).tokens)).toEqual(["Goblin", "Hero"]);
  });

  it("needs light or darkvision in a dark scene, and hides secret doors", async () => {
    const { dm, as, ds, ref, scene, hero, goblin, wall } = await visionTable();
    await emit(ds, "wall:delete", { ...ref, wallIds: [wall.id] });
    await dm.client.patch(`/api/campaigns/${ref.campaignId}/scenes/${scene.id}`, { vision: { enabled: true, ambient: "dark" } });
    // 700 px apart = 50 ft. Nothing lit: the goblin is invisible.
    expect(names((await emit(as, "scene:join", ref)).data.tokens)).toEqual(["Hero"]);
    // Darkvision 60 ft is enough.
    await emit(ds, "token:update", { ...ref, tokenId: hero.id, patch: { sight: { darkvision: 60 } } });
    expect(names((await emit(as, "scene:join", ref)).data.tokens)).toEqual(["Goblin", "Hero"]);
    // Without darkvision, the goblin's own torch gives it away.
    await emit(ds, "token:update", { ...ref, tokenId: hero.id, patch: { sight: null } });
    await emit(ds, "token:update", { ...ref, tokenId: goblin.id, patch: { light: { bright: 20, dim: 40, color: "#ffb347" } } });
    expect(names((await emit(as, "scene:join", ref)).data.tokens)).toEqual(["Goblin", "Hero"]);
    // Players can't give themselves darkvision.
    expect((await emit(as, "token:update", { ...ref, tokenId: hero.id, patch: { sight: { darkvision: 120 } } })).ok).toBe(false);

    // A secret door reaches players as a plain wall they can't open.
    const secret = (await emit(ds, "wall:add", { ...ref, walls: [{ x1: 300, y1: 0, x2: 300, y2: 1000 }], kind: "secret" })).data.walls[0];
    const seen = (await emit(as, "scene:join", ref)).data.walls.find((w: { id: string }) => w.id === secret.id);
    expect(seen).toMatchObject({ kind: "wall", open: false });
    expect((await emit(as, "door:toggle", { ...ref, wallId: secret.id })).ok).toBe(false);
    expect((await emit(ds, "scene:join", ref)).data.walls.find((w: { id: string }) => w.id === secret.id).kind).toBe("secret");
  });
});

describe("voice chat signalling", () => {
  it("introduces peers and relays offers only inside the campaign's voice channel", async () => {
    const { id, ds, as } = await visionTable();
    const outsider = await registerUser(ctx.app);
    const os = await open(outsider.client.cookie);

    expect((await emit(os, "voice:join", { campaignId: id })).ok).toBe(false);
    const first = await emit(ds, "voice:join", { campaignId: id });
    expect(first.data.peers).toEqual([]);
    expect(first.data.iceServers[0].urls).toMatch(/^stun:/);

    const joined = next(ds, "voice:peer-joined");
    const second = await emit(as, "voice:join", { campaignId: id });
    expect(second.data.peers).toHaveLength(1);
    const dmPeer = second.data.peers[0].peerId;
    expect((await joined).peer.peerId).toBe(as.id);

    const got = next(ds, "voice:signal");
    as.emit("voice:signal", { campaignId: id, to: dmPeer, data: { sdp: { type: "offer", sdp: "v=0 fake" } } });
    expect(await got).toMatchObject({ from: as.id, data: { sdp: { type: "offer" } } });

    // Someone outside voice can't signal into it.
    let leaked = false;
    ds.once("voice:signal", () => (leaked = true));
    os.emit("voice:signal", { campaignId: id, to: dmPeer, data: { sdp: { type: "offer", sdp: "x" } } });
    await wait(100);
    expect(leaked).toBe(false);

    const muted = next(ds, "voice:peer-state");
    await emit(as, "voice:mute", { campaignId: id, muted: true });
    expect(await muted).toMatchObject({ peerId: as.id, muted: true });

    const left = next(ds, "voice:peer-left");
    as.disconnect();
    expect((await left).peerId).toBe(second.data.self);
  });
});
