import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { spellSheetEntry, getSrdSpell } from "@vtt/rules";
import { createCampaign, registerUser, setupApp, upload, wavBytes } from "./helpers.js";

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

const wizard = (spells: unknown[], inventory: unknown[] = []) => ({
  classes: [{ name: "Wizard", level: 5, hitDie: 6 }],
  abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  spellcasting: {
    ability: "int",
    slots: [{ max: 4, used: 0 }, { max: 3, used: 0 }, { max: 1, used: 0 }, ...Array.from({ length: 6 }, () => ({ max: 0, used: 0 }))],
    spells,
  },
  inventory,
});

async function table() {
  const dm = await registerUser(ctx.app);
  const { id, code } = await createCampaign(dm.client, { rulesetId: "dnd5e-2014" });
  const alice = await registerUser(ctx.app);
  const bob = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  await bob.client.post(`/api/invitations/${code}/accept`);
  const mk = async (c: typeof dm.client, name: string, data: unknown) => {
    const ch = (await c.post("/api/characters", { name, rulesetId: "dnd5e-2014", data })).json().character;
    expect((await c.put(`/api/campaigns/${id}/character`, { characterId: ch.id })).statusCode).toBe(200);
    return ch;
  };
  const elara = await mk(alice.client, "Elara", wizard(
    [spellSheetEntry(getSrdSpell("fireball")!, "s-fb"), spellSheetEntry(getSrdSpell("fire-bolt")!, "s-bolt"), spellSheetEntry(getSrdSpell("detect-magic")!, "s-dm"), spellSheetEntry(getSrdSpell("magic-missile")!, "s-mm")],
    [{ id: "potion", name: "Potion of Healing", category: "potion", quantity: 3 }, { id: "rope", name: "Rope", category: "gear", quantity: 1, equipped: true }],
  ));
  const brann = await mk(bob.client, "Brann", { classes: [{ name: "Fighter", level: 5, hitDie: 10 }], inventory: [{ id: "p2", name: "potion of healing", category: "potion", quantity: 1 }] });
  return { id, dm, alice, bob, elara, brann };
}

describe("spell casting", () => {
  it("spends slots on the server, rolls damage and saves, and refuses what it can't do", async () => {
    const { id, alice, bob, elara } = await table();
    const cast = (c: typeof alice.client, body: unknown, charId = elara.id) => c.post(`/api/campaigns/${id}/characters/${charId}/cast`, body);

    const fb = await cast(alice.client, { spellId: "s-fb", slotLevel: 3 });
    expect(fb.statusCode).toBe(200);
    const r = fb.json();
    // Int 18 (+4), PB +3 → DC 15; 8d6 at 3rd level; 20-ft sphere.
    expect(r).toMatchObject({ slotSpent: true, slotLevel: 3, saveDc: 15, save: "dex", area: { shape: "sphere", sizeFt: 20 } });
    expect(r.rolls).toHaveLength(1);
    expect(r.rolls[0]).toMatchObject({ formula: "8d6", label: "Fireball — fire damage", rollType: "damage" });
    expect(r.rolls[0].total).toBeGreaterThanOrEqual(8);

    // The only 3rd-level slot is gone; upcasting needs a real slot.
    expect((await cast(alice.client, { spellId: "s-fb", slotLevel: 3 })).statusCode).toBe(409);
    expect((await cast(alice.client, { spellId: "s-fb", slotLevel: 2 })).statusCode).toBe(400);
    const sheet = (await alice.client.get(`/api/characters/${elara.id}`)).json().character;
    expect(sheet.data.spellcasting.slots[2]).toEqual({ max: 1, used: 1 });

    // Upcast Magic Missile at 2nd: 4 darts, no attack rolls.
    const mm = (await cast(alice.client, { spellId: "s-mm", slotLevel: 2 })).json();
    expect(mm.rolls.map((x: any) => x.label)).toEqual([1, 2, 3, 4].map((n) => `Magic Missile ${n}/4 — force damage`));

    // Cantrip at level 5: attack + 2d10, no slot.
    const bolt = (await cast(alice.client, { spellId: "s-bolt" })).json();
    expect(bolt.slotSpent).toBe(false);
    expect(bolt.rolls.map((x: any) => x.formula)).toEqual(["1d20+7", "2d10"]);

    // Ritual: no slot; non-ritual spells can't be.
    expect((await cast(alice.client, { spellId: "s-dm", ritual: true })).json().slotSpent).toBe(false);
    expect((await cast(alice.client, { spellId: "s-mm", ritual: true })).statusCode).toBe(400);

    // Not your character / not on the sheet / players can't roll DM-only.
    expect((await cast(bob.client, { spellId: "s-bolt" })).statusCode).toBe(403);
    expect((await cast(alice.client, { spellId: "nope" })).statusCode).toBe(400);
    expect((await cast(alice.client, { spellId: "s-bolt", visibility: "dm_only" })).statusCode).toBe(403);

    // The cast is announced and the rolls are in the log.
    const msgs = (await alice.client.get(`/api/campaigns/${id}/chat`)).json().messages as any[];
    expect(msgs.some((m) => m.content === "Elara casts Fireball at 3rd level — DC 15 Dex save (half on success) — 20-ft sphere")).toBe(true);
  });
});

describe("giving items", () => {
  it("moves and merges stacks between characters at the table", async () => {
    const { id, alice, bob, dm, elara, brann } = await table();
    const give = (c: typeof alice.client, body: unknown, from = elara.id) => c.post(`/api/campaigns/${id}/characters/${from}/give`, body);
    const targets = (await alice.client.get(`/api/campaigns/${id}/give-targets`)).json().characters.map((c: any) => c.name).sort();
    expect(targets).toEqual(["Brann", "Elara"]);

    const r = await give(alice.client, { itemId: "potion", quantity: 2, toCharacterId: brann.id });
    expect(r.statusCode).toBe(200);
    const inv = async (c: typeof alice.client, charId: string) => (await c.get(`/api/characters/${charId}`)).json().character.data.inventory;
    expect((await inv(alice.client, elara.id)).find((i: any) => i.id === "potion").quantity).toBe(1);
    // Merged into Brann's existing stack (name match is case-insensitive).
    expect(await inv(bob.client, brann.id)).toEqual([expect.objectContaining({ name: "potion of healing", quantity: 3 })]);

    // Giving the whole stack removes it; equipped doesn't travel.
    await give(alice.client, { itemId: "rope", quantity: 1, toCharacterId: brann.id });
    expect((await inv(alice.client, elara.id)).some((i: any) => i.id === "rope")).toBe(false);
    expect((await inv(bob.client, brann.id)).find((i: any) => i.name === "Rope")).toMatchObject({ quantity: 1, equipped: false });

    expect((await give(alice.client, { itemId: "potion", quantity: 5, toCharacterId: brann.id })).statusCode).toBe(400);
    expect((await give(bob.client, { itemId: "potion", quantity: 1, toCharacterId: brann.id })).statusCode).toBe(403);
    const stranger = (await dm.client.post("/api/characters", { name: "Outsider", rulesetId: "dnd5e-2014" })).json().character;
    expect((await give(alice.client, { itemId: "potion", quantity: 1, toCharacterId: stranger.id })).statusCode).toBe(400);
    const msgs = (await alice.client.get(`/api/campaigns/${id}/chat`)).json().messages as any[];
    expect(msgs.some((m) => m.content === "Elara gave 2× Potion of Healing to Brann")).toBe(true);
  });
});

describe("AoE templates", () => {
  it("syncs templates, keeps hidden ones DM-only and enforces ownership", async () => {
    const { id, dm, alice, bob } = await table();
    const scene = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Field", width: 1400, height: 1000 })).json().scene;
    const ds = await open(dm.client.cookie);
    const as = await open(alice.client.cookie);
    const bs = await open(bob.client.cookie);
    for (const s of [ds, as, bs]) await emit(s, "campaign:join", { campaignId: id });
    for (const s of [ds, as, bs]) expect((await emit(s, "scene:join", { campaignId: id, sceneId: scene.id })).data.templates).toEqual([]);
    const bobSees = collect(bs, "template:upsert");
    const bobRemoved = collect(bs, "template:remove");
    const ref = { campaignId: id, sceneId: scene.id };

    const cone = await emit(as, "template:create", { ...ref, template: { shape: "cone", x: 100, y: 100, size: 15, angle: 45, label: "Burning Hands" } });
    expect(cone.ok).toBe(true);
    expect(cone.data).toMatchObject({ shape: "cone", width: 5, color: "#e0603a", hidden: false });
    expect((await emit(as, "template:create", { ...ref, template: { shape: "circle", x: 0, y: 0, size: 10, hidden: true } })).code).toBe("forbidden");
    const trap = await emit(ds, "template:create", { ...ref, template: { shape: "square", x: 300, y: 300, size: 10, hidden: true, label: "Pit trap" } });
    await tick();
    expect(bobSees.map((t) => t.label)).toEqual(["Burning Hands"]);

    // Only the owner (or DM) can move/delete; update touches only what was sent.
    expect((await emit(bs, "template:update", { ...ref, templateId: cone.data.id, patch: { x: 1 } })).code).toBe("forbidden");
    const moved = await emit(as, "template:update", { ...ref, templateId: cone.data.id, patch: { angle: 90 } });
    expect(moved.data).toMatchObject({ angle: 90, x: 100, label: "Burning Hands", color: "#e0603a" });
    expect((await emit(bs, "template:delete", { ...ref, templateId: trap.data.id })).code).toBe("not_found");

    // Revealing the trap shows it to players; scene state includes it.
    await emit(ds, "template:update", { ...ref, templateId: trap.data.id, patch: { hidden: false } });
    await tick();
    expect(bobSees.at(-1).label).toBe("Pit trap");
    expect((await emit(bs, "scene:join", ref)).data.templates).toHaveLength(2);
    await emit(as, "template:delete", { ...ref, templateId: cone.data.id });
    await tick();
    expect(bobRemoved).toEqual([{ sceneId: scene.id, templateId: cone.data.id }]);
    expect((await emit(as, "template:clear", ref)).code).toBe("forbidden");
    expect((await emit(ds, "template:clear", ref)).ok).toBe(true);
    expect((await emit(bs, "scene:join", ref)).data.templates).toEqual([]);
  });
});

describe("scene music", () => {
  it("starts the scene's playlist when the DM shows the scene", async () => {
    const { id, dm, alice } = await table();
    const asset = (await upload(ctx.app, dm.client, { kind: "audio", campaignId: id }, wavBytes(0.5), "tavern.wav")).json().asset;
    const track = (await dm.client.post(`/api/campaigns/${id}/audio/tracks`, { assetId: asset.id, name: "Tavern", durationSec: 60 })).json().track;
    const pl = (await dm.client.post(`/api/campaigns/${id}/audio/playlists`, { name: "Inn", trackIds: [track.id] })).json().playlist;
    const first = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Road", width: 1000, height: 1000 })).json().scene;
    const inn = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Inn", width: 1000, height: 1000 })).json().scene;
    expect((await dm.client.patch(`/api/campaigns/${id}/scenes/${inn.id}`, { music: { kind: "playlist", id: "00000000-0000-4000-8000-000000000000" } })).statusCode).toBe(400);
    const patched = (await dm.client.patch(`/api/campaigns/${id}/scenes/${inn.id}`, { music: { kind: "playlist", id: pl.id } })).json().scene;
    expect(patched.music).toEqual({ kind: "playlist", id: pl.id });
    // Players don't see scene music settings.
    expect((await alice.client.get(`/api/campaigns/${id}/scenes`)).json().scenes[0]).not.toHaveProperty("music");

    const as = await open(alice.client.cookie);
    await emit(as, "campaign:join", { campaignId: id });
    const states = collect(as, "audio:state");
    expect((await dm.client.post(`/api/campaigns/${id}/active-scene`, { sceneId: inn.id })).statusCode).toBe(200);
    await tick();
    expect(states.at(-1).audio.music).toMatchObject({ playing: true, track: { name: "Tavern" } });
    // Re-showing the same scene doesn't restart the song.
    const rev = states.at(-1).audio.revision;
    await dm.client.post(`/api/campaigns/${id}/active-scene`, { sceneId: first.id });
    await dm.client.post(`/api/campaigns/${id}/active-scene`, { sceneId: inn.id });
    await tick();
    expect(states.at(-1).audio.revision).toBe(rev);
  });
});
