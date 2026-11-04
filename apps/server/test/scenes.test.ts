import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createCampaign, pngBytes, registerUser, setupApp, upload } from "./helpers.js";

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
function emit<T = any>(s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}
function collect(s: Socket, event: string) {
  const items: any[] = [];
  s.on(event, (p) => items.push(p));
  return items;
}
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function table() {
  const dm = await registerUser(ctx.app);
  const { id, code } = await createCampaign(dm.client);
  const alice = await registerUser(ctx.app);
  const bob = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  await bob.client.post(`/api/invitations/${code}/accept`);
  return { id, dm, alice, bob };
}

describe("assets", () => {
  it("accepts real images, records dimensions and serves them to members only", async () => {
    const { id, dm, alice } = await table();
    const res = await upload(ctx.app, dm.client, { kind: "map", campaignId: id }, pngBytes(1400, 1000));
    expect(res.statusCode).toBe(201);
    const asset = res.json().asset;
    expect(asset).toMatchObject({ kind: "map", mime: "image/png", width: 1400, height: 1000 });

    const got = await alice.client.get(asset.url);
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.rawPayload.subarray(1, 4).toString()).toBe("PNG");

    const outsider = await registerUser(ctx.app);
    expect((await outsider.client.get(asset.url)).statusCode).toBe(404);
  });

  it("rejects disguised files, oversized images and player map uploads", async () => {
    const { id, dm, alice } = await table();
    const html = Buffer.from("<html><script>alert(1)</script></html>".padEnd(64, " "));
    const bad = await upload(ctx.app, dm.client, { kind: "map", campaignId: id }, html, "evil.png");
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/Unsupported file type/);

    const huge = await upload(ctx.app, dm.client, { kind: "map", campaignId: id }, pngBytes(20000, 100));
    expect(huge.statusCode).toBe(400);

    const playerMap = await upload(ctx.app, alice.client, { kind: "map", campaignId: id }, pngBytes(100, 100));
    expect(playerMap.statusCode).toBe(403);
    const playerToken = await upload(ctx.app, alice.client, { kind: "token", campaignId: id }, pngBytes(100, 100));
    expect(playerToken.statusCode).toBe(201);
  });
});

describe("scenes", () => {
  it("creates scenes sized from the map image; first scene becomes active", async () => {
    const { id, dm, alice } = await table();
    const asset = (await upload(ctx.app, dm.client, { kind: "map", campaignId: id }, pngBytes(1400, 1000))).json().asset;
    const res = await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Goblin Cave", backgroundAssetId: asset.id, grid: { size: 70 } });
    expect(res.statusCode).toBe(201);
    const scene = res.json().scene;
    expect(scene).toMatchObject({ width: 1400, height: 1000, isActive: true, grid: { type: "square", size: 70, unitsPerCell: 5 } });

    const second = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Secret Lair" })).json().scene;
    expect(second.isActive).toBe(false);

    // Players see only the active scene, never DM notes, never other scenes.
    await dm.client.patch(`/api/campaigns/${id}/scenes/${scene.id}`, { dmNotes: "The boss hides behind the waterfall" });
    const list = (await alice.client.get(`/api/campaigns/${id}/scenes`)).json();
    expect(list.scenes).toHaveLength(1);
    expect(list.scenes[0].dmNotes).toBeUndefined();
    expect((await dm.client.get(`/api/campaigns/${id}/scenes`)).json().scenes).toHaveLength(2);

    // Players cannot create/edit/activate.
    expect((await alice.client.post(`/api/campaigns/${id}/scenes`, { name: "x" })).statusCode).toBe(403);
    expect((await alice.client.patch(`/api/campaigns/${id}/scenes/${scene.id}`, { name: "x" })).statusCode).toBe(403);
    expect((await alice.client.post(`/api/campaigns/${id}/active-scene`, { sceneId: second.id })).statusCode).toBe(403);
  });

  it("validates grid and size, supports optimistic versioning, duplicate and delete", async () => {
    const { id, dm } = await table();
    const scene = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Field" })).json().scene;
    expect((await dm.client.patch(`/api/campaigns/${id}/scenes/${scene.id}`, { grid: { size: 5 } })).statusCode).toBe(400);
    expect((await dm.client.patch(`/api/campaigns/${id}/scenes/${scene.id}`, { width: 99999 })).statusCode).toBe(400);
    const ok = await dm.client.patch(`/api/campaigns/${id}/scenes/${scene.id}`, { grid: { type: "hex" }, expectedVersion: scene.version });
    expect(ok.json().scene.grid).toMatchObject({ type: "hex", size: 70 });
    const stale = await dm.client.patch(`/api/campaigns/${id}/scenes/${scene.id}`, { name: "B", expectedVersion: scene.version });
    expect(stale.statusCode).toBe(409);

    const copy = (await dm.client.post(`/api/campaigns/${id}/scenes/${scene.id}/duplicate`)).json().scene;
    expect(copy.name).toBe("Field (copy)");
    expect((await dm.client.del(`/api/campaigns/${id}/scenes/${scene.id}`)).statusCode).toBe(200);
    const after = (await dm.client.get(`/api/campaigns/${id}/scenes`)).json();
    expect(after.scenes.map((s: any) => s.id)).toEqual([copy.id]);
    expect(after.activeSceneId).toBeNull();
  });
});

describe("tokens and fog over realtime", () => {
  async function liveTable() {
    const t = await table();
    const scene = (await t.dm.client.post(`/api/campaigns/${t.id}/scenes`, { name: "Crypt", width: 1000, height: 1000, grid: { size: 50 } })).json().scene;
    const s = { dm: await open(t.dm.client.cookie), alice: await open(t.alice.client.cookie), bob: await open(t.bob.client.cookie) };
    for (const sock of Object.values(s)) {
      expect((await emit(sock, "campaign:join", { campaignId: t.id })).ok).toBe(true);
      expect((await emit(sock, "scene:join", { campaignId: t.id, sceneId: scene.id })).ok).toBe(true);
    }
    return { ...t, scene, s, ref: { campaignId: t.id, sceneId: scene.id } };
  }

  it("syncs token creation and movement to every client and persists it", async () => {
    const { s, ref, alice, id, scene } = await liveTable();
    const bobSees = collect(s.bob, "token:upsert");
    const created = await emit(s.dm, "token:create", { ...ref, token: { name: "Ogre", x: 125, y: 125, size: 2, ownerIds: [alice.user.id] } });
    expect(created.ok).toBe(true);
    const tokenId = created.data.id;
    await tick();
    expect(bobSees.at(-1)).toMatchObject({ id: tokenId, name: "Ogre", x: 125 });

    // Owner moves it; others receive the new position with a higher version.
    const moved = await emit(s.alice, "token:update", { ...ref, tokenId, patch: { x: 300, y: 310 } });
    expect(moved.ok).toBe(true);
    await tick();
    expect(bobSees.at(-1)).toMatchObject({ id: tokenId, x: 300, y: 310, version: 2 });

    // Non-owner can't move; owner can't rename or hide.
    expect((await emit(s.bob, "token:update", { ...ref, tokenId, patch: { x: 1 } })).error).toMatch(/can't move/);
    expect((await emit(s.alice, "token:update", { ...ref, tokenId, patch: { hidden: true } })).error).toMatch(/Only the DM/);

    // Reconnect: a fresh socket gets the persisted state.
    const again = await open(alice.client.cookie);
    await emit(again, "campaign:join", { campaignId: id });
    const state = await emit(again, "scene:join", { campaignId: id, sceneId: scene.id });
    expect(state.data.tokens).toEqual([expect.objectContaining({ id: tokenId, x: 300, y: 310 })]);
  });

  it("never sends hidden tokens to players, and removes tokens that become hidden", async () => {
    const { s, ref, bob } = await liveTable();
    const bobUpserts = collect(s.bob, "token:upsert");
    const bobRemoves = collect(s.bob, "token:remove");
    const secret = await emit(s.dm, "token:create", { ...ref, token: { name: "Assassin", x: 100, y: 100, hidden: true } });
    await tick();
    expect(bobUpserts.find((t) => t.id === secret.data.id)).toBeUndefined();
    const visible = await emit(s.dm, "token:create", { ...ref, token: { name: "Guard", x: 200, y: 200 } });
    await tick();
    expect(bobUpserts.find((t) => t.id === visible.data.id)).toBeTruthy();
    await emit(s.dm, "token:update", { ...ref, tokenId: visible.data.id, patch: { hidden: true } });
    await tick();
    expect(bobRemoves.at(-1)).toEqual({ sceneId: ref.sceneId, tokenId: visible.data.id });

    // Fresh join doesn't include them either.
    const state = await emit(s.bob, "scene:join", ref);
    expect(state.data.tokens).toHaveLength(0);
    void bob;
  });

  it("filters tokens by fog server-side and pushes new state on fog changes", async () => {
    const { s, ref, alice } = await liveTable();
    await emit(s.dm, "token:create", { ...ref, token: { name: "Mimic", x: 800, y: 800 } });
    const mine = await emit(s.dm, "token:create", { ...ref, token: { name: "Alice", x: 900, y: 900, ownerIds: [alice.user.id] } });
    const bobStates = collect(s.bob, "scene:state");
    const aliceStates = collect(s.alice, "scene:state");

    expect((await emit(s.alice, "fog:enable", { ...ref, enabled: true })).error).toMatch(/Only the DM/);
    expect((await emit(s.dm, "fog:enable", { ...ref, enabled: true })).ok).toBe(true);
    await tick();
    expect(bobStates.at(-1).tokens).toHaveLength(0);
    // Owners always see their own token under fog.
    expect(aliceStates.at(-1).tokens.map((t: any) => t.id)).toEqual([mine.data.id]);

    await emit(s.dm, "fog:add", { ...ref, mode: "reveal", shape: { kind: "circle", x: 800, y: 800, radius: 60 } });
    await tick();
    expect(bobStates.at(-1).tokens.map((t: any) => t.name)).toEqual(["Mimic"]);
    expect(bobStates.at(-1).fog).toHaveLength(1);

    expect((await emit(s.dm, "fog:undo", ref)).data).toEqual({ undone: true });
    await tick();
    expect(bobStates.at(-1).tokens).toHaveLength(0);

    await emit(s.dm, "fog:reset", { ...ref, mode: "reveal" });
    await tick();
    expect(bobStates.at(-1).tokens).toHaveLength(2);
    const bad = await emit(s.dm, "fog:add", { ...ref, mode: "hide", shape: { kind: "circle", x: 1, y: 1, radius: 0 } });
    expect(bad.ok).toBe(false);
  });

  it("players can place only their own character, once; only DMs delete tokens", async () => {
    const { s, ref, alice } = await liveTable();
    const pc = (await alice.client.post("/api/characters", { name: "Lyra", rulesetId: "dnd5e-2024" })).json().character;
    expect((await alice.client.put(`/api/campaigns/${ref.campaignId}/character`, { characterId: pc.id })).statusCode).toBe(200);
    expect((await emit(s.alice, "token:create", { ...ref, token: { name: "Free token", x: 10, y: 10 } })).error).toMatch(/Only the DM/);
    const placed = await emit(s.alice, "token:create", { ...ref, token: { characterId: pc.id, x: 75, y: 75, hidden: true, name: "Hack" } });
    expect(placed.ok).toBe(true);
    expect(placed.data).toMatchObject({ name: "Lyra", hidden: false, ownerIds: [alice.user.id] });
    expect((await emit(s.alice, "token:create", { ...ref, token: { characterId: pc.id, x: 5, y: 5 } })).error).toMatch(/already on this map/);
    expect((await emit(s.alice, "token:delete", { ...ref, tokenId: placed.data.id })).error).toMatch(/Only the DM/);
    const removes = collect(s.bob, "token:remove");
    expect((await emit(s.dm, "token:delete", { ...ref, tokenId: placed.data.id })).ok).toBe(true);
    await tick();
    expect(removes.at(-1).tokenId).toBe(placed.data.id);
  });

  it("switching the active scene evicts players from the old scene", async () => {
    const { s, ref, dm, id } = await liveTable();
    const other = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Town" })).json().scene;
    const activated = collect(s.bob, "scene:activated");
    await dm.client.post(`/api/campaigns/${id}/active-scene`, { sceneId: other.id });
    await tick();
    expect(activated.at(-1)).toEqual({ campaignId: id, sceneId: other.id });
    const bobUpserts = collect(s.bob, "token:upsert");
    await emit(s.dm, "token:create", { ...ref, token: { name: "Left behind", x: 50, y: 50 } });
    await tick();
    expect(bobUpserts).toHaveLength(0);
    expect((await emit(s.bob, "scene:join", ref)).error).toBe("Scene not found");
    expect((await emit(s.bob, "scene:join", { campaignId: id, sceneId: other.id })).ok).toBe(true);
  });
});
