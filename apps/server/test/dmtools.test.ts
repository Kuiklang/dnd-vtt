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
const emit = (s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: any; error?: string }> =>
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
  const bob = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  await bob.client.post(`/api/invitations/${code}/accept`);
  return { id, dm, alice, bob };
}

describe("journal & handouts", () => {
  it("filters entries per viewer, keeps personal notes private, and enforces edit rights", async () => {
    const { id, dm, alice, bob } = await table();
    const j = `/api/campaigns/${id}/journal`;
    const secret = (await dm.client.post(j, { title: "Villain plan", body: "The mayor is the cult leader." })).json().entry;
    expect(secret.visibility).toBe("gm");
    const lore = (await dm.client.post(j, { title: "Town of Brindle", body: "# Brindle\nA quiet town.", visibility: "all", folder: "Places" })).json().entry;
    const forAlice = (await dm.client.post(j, { title: "Alice's dream", visibility: "selected", sharedWith: [alice.user.id] })).json().entry;
    const note = (await alice.client.post(j, { title: "My suspicions", body: "Mayor is shifty" })).json().entry;
    expect(note.visibility).toBe("author");

    const titles = async (c: typeof dm.client) => ((await c.get(j)).json().entries as any[]).map((e) => e.title).sort();
    expect(await titles(dm.client)).toEqual(["Alice's dream", "Town of Brindle", "Villain plan"]);
    expect(await titles(alice.client)).toEqual(["Alice's dream", "My suspicions", "Town of Brindle"]);
    expect(await titles(bob.client)).toEqual(["Town of Brindle"]);
    expect((await bob.client.get(`${j}/${secret.id}`)).statusCode).toBe(404);
    expect((await dm.client.get(`${j}/${note.id}`)).statusCode).toBe(404);

    // Players can't make DM-only entries, pin, or edit what isn't theirs.
    expect((await bob.client.post(j, { title: "x", visibility: "gm" })).statusCode).toBe(403);
    expect((await bob.client.post(j, { title: "x", visibility: "all", pinned: true })).statusCode).toBe(403);
    expect((await bob.client.put(`${j}/${lore.id}`, { expectedVersion: 1, body: "vandalised" })).statusCode).toBe(403);
    expect((await alice.client.put(`${j}/${forAlice.id}`, { expectedVersion: 1, body: "x" })).statusCode).toBe(403);
    expect((await dm.client.post(j, { title: "x", sharedWith: ["00000000-0000-4000-8000-000000000000"], visibility: "selected" })).statusCode).toBe(400);

    // Optimistic versioning.
    expect((await dm.client.put(`${j}/${lore.id}`, { expectedVersion: 1, body: "Updated" })).statusCode).toBe(200);
    expect((await dm.client.put(`${j}/${lore.id}`, { expectedVersion: 1, body: "Stale" })).statusCode).toBe(409);
    // sharedWith is only shown to editors.
    expect((await alice.client.get(`${j}/${forAlice.id}`)).json().entry.sharedWith).toEqual([]);
  });

  it("pushes changes only to viewers who may see them, and shows handouts", async () => {
    const { id, dm, alice, bob } = await table();
    const j = `/api/campaigns/${id}/journal`;
    const s = { dm: await open(dm.client.cookie), alice: await open(alice.client.cookie), bob: await open(bob.client.cookie) };
    for (const sock of Object.values(s)) expect((await emit(sock, "campaign:join", { campaignId: id })).ok).toBe(true);
    const ups = { dm: collect(s.dm, "journal:upsert"), alice: collect(s.alice, "journal:upsert"), bob: collect(s.bob, "journal:upsert") };
    const removes = { bob: collect(s.bob, "journal:remove") };
    const shown = { alice: collect(s.alice, "handout:show"), bob: collect(s.bob, "handout:show"), dm: collect(s.dm, "handout:show") };

    // A DM-only handout with an image: players can't fetch the image yet.
    const img = (await upload(ctx.app, dm.client, { kind: "handout", campaignId: id }, pngBytes(40, 30), "letter.png")).json().asset;
    const entry = (await dm.client.post(j, { title: "Sealed letter", body: "Meet at midnight.", imageAssetId: img.id })).json().entry;
    await tick();
    expect(ups.dm.length).toBe(1);
    expect(ups.alice.length + ups.bob.length).toBe(0);
    expect((await alice.client.get(`/api/assets/${img.id}`)).statusCode).toBe(404);
    expect(((await alice.client.get(`/api/campaigns/${id}/assets`)).json().assets as any[]).some((a) => a.id === img.id)).toBe(false);

    // Show it to Alice only: she gets it pushed on screen and can now load the image; Bob hears nothing.
    const res = await dm.client.post(`${j}/${entry.id}/show`, { to: [alice.user.id] });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry.visibility).toBe("selected");
    await tick();
    expect(shown.alice.map((x) => x.entry.title)).toEqual(["Sealed letter"]);
    expect(shown.alice[0].entry.imageUrl).toBe(`/api/assets/${img.id}`);
    expect(shown.bob.length + shown.dm.length).toBe(0);
    expect(ups.bob.length).toBe(0);
    expect((await alice.client.get(`/api/assets/${img.id}`)).statusCode).toBe(200);
    expect((await bob.client.get(`/api/assets/${img.id}`)).statusCode).toBe(404);

    // Show to everyone, then hide again: Bob gets it, then a removal.
    await dm.client.post(`${j}/${entry.id}/show`, { to: "all" });
    await tick();
    expect(shown.bob.length).toBe(1);
    const v = (await dm.client.get(`${j}/${entry.id}`)).json().entry.version;
    await dm.client.put(`${j}/${entry.id}`, { expectedVersion: v, visibility: "gm" });
    await tick();
    expect(removes.bob.map((r) => r.id)).toEqual([entry.id]);
    expect((await bob.client.get(`/api/assets/${img.id}`)).statusCode).toBe(404);

    // Players can't show handouts.
    expect((await alice.client.post(`${j}/${entry.id}/show`, { to: "all" })).statusCode).toBe(403);
  });
});

describe("encounters & random tables", () => {
  it("saves encounters for DMs only", async () => {
    const { id, dm, alice } = await table();
    const e = `/api/campaigns/${id}/encounters`;
    const body = { name: "Goblin ambush", entries: [{ ref: { type: "srd", id: "goblin" }, name: "Goblin", count: 4, xp: 50 }, { ref: { type: "srd", id: "bugbear" }, name: "Bugbear", count: 1, xp: 200 }] };
    expect((await alice.client.post(e, body)).statusCode).toBe(403);
    expect((await alice.client.get(e)).statusCode).toBe(403);
    const created = (await dm.client.post(e, body)).json().encounter;
    expect(created.totalXp).toBe(400);
    const upd = await dm.client.put(`${e}/${created.id}`, { expectedVersion: 1, entries: [{ ...body.entries[0], count: 6 }] });
    expect(upd.json().encounter.totalXp).toBe(300);
    expect((await dm.client.put(`${e}/${created.id}`, { expectedVersion: 1, name: "x" })).statusCode).toBe(409);
    expect((await dm.client.post(e, { name: "Too many", entries: [{ ...body.entries[0], count: 99 }] })).statusCode).toBe(400);
    expect((await dm.client.get(e)).json().encounters).toHaveLength(1);
    expect((await dm.client.del(`${e}/${created.id}`)).statusCode).toBe(200);
  });

  it("validates tables and rolls on the server into the dice log", async () => {
    const { id, dm, alice } = await table();
    const t = `/api/campaigns/${id}/tables`;
    expect((await dm.client.post(t, { name: "Bad", formula: "1d6", entries: [{ min: 1, max: 4, text: "a" }, { min: 3, max: 6, text: "b" }] })).json().error.message).toMatch(/overlap/);
    expect((await dm.client.post(t, { name: "Bad", formula: "1d6", entries: [{ min: 1, max: 8, text: "a" }] })).json().error.message).toMatch(/outside/);
    expect((await dm.client.post(t, { name: "Bad", formula: "d6+eval", entries: [] })).statusCode).toBe(400);
    expect((await alice.client.post(t, { name: "Mine", formula: "1d4", entries: [{ min: 1, max: 4, text: "x" }] })).statusCode).toBe(403);

    const weather = (
      await dm.client.post(t, {
        name: "Weather",
        formula: "1d4",
        entries: [
          { min: 1, max: 2, text: "Clear skies" },
          { min: 3, max: 3, text: "Rain" },
          { min: 4, max: 4, text: "Storm" },
        ],
      })
    ).json().table;
    const sock = { dm: await open(dm.client.cookie), alice: await open(alice.client.cookie) };
    for (const s of Object.values(sock)) await emit(s, "campaign:join", { campaignId: id });
    const rolls = { dm: collect(sock.dm, "dice:roll"), alice: collect(sock.alice, "dice:roll") };
    const r = (await dm.client.post(`${t}/${weather.id}/roll`, {})).json();
    expect(["Clear skies", "Rain", "Storm"]).toContain(r.entry.text);
    expect(r.roll.label).toBe(`Weather: ${r.entry.text}`);
    expect(r.roll.visibility).toBe("dm_only");
    await tick();
    expect(rolls.dm.length).toBe(1);
    // Players see that the DM rolled something hidden, but not the label or result.
    for (const x of rolls.alice) expect(x.label ?? "").not.toContain(r.entry.text);
    const pub = (await dm.client.post(`${t}/${weather.id}/roll`, { visibility: "public" })).json();
    await tick();
    expect(rolls.alice.some((x) => x.id === pub.roll.id && x.label === `Weather: ${pub.entry.text}`)).toBe(true);
    expect((await alice.client.post(`${t}/${weather.id}/roll`, {})).statusCode).toBe(403);
  });

  it("keeps a token's stat block link when stats are edited, and hides it from players", async () => {
    const { id, dm, alice } = await table();
    const scene = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Cave", width: 500, height: 500, grid: { size: 50 } })).json().scene;
    const s = { dm: await open(dm.client.cookie), alice: await open(alice.client.cookie) };
    const ref = { campaignId: id, sceneId: scene.id };
    for (const sock of Object.values(s)) {
      await emit(sock, "campaign:join", { campaignId: id });
      await emit(sock, "scene:join", ref);
    }
    const aliceTokens = collect(s.alice, "token:upsert");
    const stats = { hp: { current: 7, max: 7, temp: 0 }, ac: 15, initiativeBonus: 2, conditions: [], defenses: { resistances: [], vulnerabilities: [], immunities: [] }, statBlock: { type: "srd", id: "goblin" } };
    const created = await emit(s.dm, "token:create", { ...ref, token: { name: "Goblin", x: 100, y: 100, stats } });
    expect(created.ok).toBe(true);
    expect(created.data.statBlock).toEqual({ type: "srd", id: "goblin" });
    // Editing AC sends stats without the link; the server keeps it.
    const { statBlock: _drop, ...noLink } = stats;
    const upd = await emit(s.dm, "token:update", { ...ref, tokenId: created.data.id, patch: { stats: { ...noLink, ac: 16 } } });
    expect(upd.data.statBlock).toEqual({ type: "srd", id: "goblin" });
    expect(upd.data.vitals.ac).toBe(16);
    await tick();
    expect(aliceTokens.length).toBeGreaterThan(0);
    for (const t of aliceTokens) expect(t.statBlock).toBeNull();
  });
});
