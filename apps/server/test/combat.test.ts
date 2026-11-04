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
function emit<T = any>(s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}
function collect(s: Socket, event: string) {
  const items: any[] = [];
  s.on(event, (p) => items.push(p));
  return items;
}
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const last = <T>(a: T[]) => a[a.length - 1];

const statsOf = (max: number, extra: Record<string, unknown> = {}) => ({
  hp: { current: max, max, temp: 0 },
  ac: 13,
  initiativeBonus: 2,
  conditions: [],
  defenses: { resistances: [], vulnerabilities: [], immunities: [] },
  ...extra,
});

async function battle() {
  const dm = await registerUser(ctx.app);
  const { id, code } = await createCampaign(dm.client);
  const alice = await registerUser(ctx.app);
  const bob = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  await bob.client.post(`/api/invitations/${code}/accept`);
  const scene = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Arena", width: 1000, height: 1000, grid: { size: 50 } })).json().scene;
  const s = { dm: await open(dm.client.cookie), alice: await open(alice.client.cookie), bob: await open(bob.client.cookie) };
  const ref = { campaignId: id, sceneId: scene.id };
  for (const sock of Object.values(s)) {
    expect((await emit(sock, "campaign:join", { campaignId: id })).ok).toBe(true);
    expect((await emit(sock, "scene:join", ref)).ok).toBe(true);
  }
  // Alice's PC on the map, linked to her sheet.
  const fresh = (await alice.client.post("/api/characters", { name: "Lyra", rulesetId: "dnd5e-2024" })).json().character;
  const pc = (await alice.client.put(`/api/characters/${fresh.id}`, { expectedVersion: fresh.version, data: { ...fresh.data, hp: { current: 20, max: 20, temp: 0 } } })).json().character;
  expect((await alice.client.put(`/api/campaigns/${id}/character`, { characterId: pc.id })).statusCode).toBe(200);
  const pcToken = (await emit(s.alice, "token:create", { ...ref, token: { characterId: pc.id, x: 75, y: 75 } })).data;
  // Reveal the whole map so players see the monsters.
  await emit(s.dm, "fog:enable", { ...ref, enabled: false });
  const goblin = (await emit(s.dm, "token:create", { ...ref, token: { name: "Goblin", x: 300, y: 300, stats: statsOf(7, { defenses: { resistances: ["fire"], vulnerabilities: [], immunities: [] } }) } })).data;
  const lurker = (await emit(s.dm, "token:create", { ...ref, token: { name: "Lurker", x: 500, y: 500, hidden: true, stats: statsOf(30) } })).data;
  return { id, dm, alice, bob, s, ref, pc, pcToken, goblin, lurker };
}

describe("combat tracker", () => {
  it("starts with scene creatures, hides secret combatants from players and runs turns", async () => {
    const b = await battle();
    const bobState = collect(b.s.bob, "combat:state");
    const started = await emit(b.s.dm, "combat:start", b.ref);
    expect(started.ok).toBe(true);
    expect(started.data.combatants.map((c: any) => c.name).sort()).toEqual(["Goblin", "Lurker", "Lyra"]);
    await tick();
    const seen = last(bobState).combat;
    expect(seen.combatants.map((c: any) => c.name).sort()).toEqual(["Goblin", "Lyra"]);
    // Monster vitals hidden from players by default, PC vitals visible.
    expect(seen.combatants.find((c: any) => c.name === "Goblin")).toMatchObject({ vitals: null, vitalsHidden: true });
    expect(seen.combatants.find((c: any) => c.name === "Lyra").vitals.hp.max).toBeGreaterThan(0);

    // A second combat can't start while one runs; players can't start or roll for everyone.
    expect((await emit(b.s.dm, "combat:start", b.ref)).error).toMatch(/already running/);
    expect((await emit(b.s.alice, "combat:end", { campaignId: b.id })).error).toMatch(/Only the DM/);
    expect((await emit(b.s.alice, "combat:roll", { campaignId: b.id, which: "all" })).error).toMatch(/Only the DM/);

    // Alice rolls her own initiative once; the DM rolls the rest.
    const mine = started.data.combatants.find((c: any) => c.name === "Lyra");
    const goblinC = started.data.combatants.find((c: any) => c.name === "Goblin");
    expect((await emit(b.s.alice, "combat:roll", { campaignId: b.id, which: [goblinC.id] })).error).toMatch(/your own/);
    expect((await emit(b.s.alice, "combat:roll", { campaignId: b.id, which: [mine.id] })).ok).toBe(true);
    expect((await emit(b.s.alice, "combat:roll", { campaignId: b.id, which: [mine.id] })).error).toMatch(/already rolled/);
    const bobRolls = collect(b.s.bob, "dice:roll");
    expect((await emit(b.s.dm, "combat:roll", { campaignId: b.id, which: "npcs" })).ok).toBe(true);
    await tick();
    // The hidden Lurker's roll is DM-only: Bob sees only the Goblin's (Lyra was rolled before collecting).
    expect(bobRolls.map((r) => r.label)).toEqual(["Goblin — Initiative"]);

    // Fix the order: Goblin 20, Lyra 15, Lurker 10.
    const ids = Object.fromEntries(started.data.combatants.map((c: any) => [c.name, c.id]));
    for (const [name, value] of [["Goblin", 20], ["Lyra", 15], ["Lurker", 10]] as const) {
      expect((await emit(b.s.dm, "combat:setInitiative", { campaignId: b.id, combatantId: ids[name], value })).ok).toBe(true);
    }
    let st = (await emit(b.s.dm, "combat:next", { campaignId: b.id })).data;
    expect(st.combatants.map((c: any) => c.name)).toEqual(["Goblin", "Lyra", "Lurker"]);
    expect(st).toMatchObject({ round: 1, activeCombatantId: ids.Goblin });
    // Not Alice's turn yet.
    expect((await emit(b.s.alice, "combat:next", { campaignId: b.id })).error).toMatch(/isn't your turn/);
    st = (await emit(b.s.dm, "combat:next", { campaignId: b.id, expectedVersion: st.version })).data;
    expect(st.activeCombatantId).toBe(ids.Lyra);
    // Stale double-click is refused.
    expect((await emit(b.s.dm, "combat:next", { campaignId: b.id, expectedVersion: st.version - 1 })).error).toMatch(/already changed/);
    // Alice uses her action, then ends her own turn.
    expect((await emit(b.s.alice, "combat:update", { campaignId: b.id, combatantId: ids.Lyra, patch: { actions: { action: true } } })).ok).toBe(true);
    expect((await emit(b.s.alice, "combat:update", { campaignId: b.id, combatantId: ids.Lyra, patch: { defeated: true } })).error).toMatch(/Only the DM/);
    st = (await emit(b.s.alice, "combat:next", { campaignId: b.id })).data;
    // Alice's view skips the hidden Lurker in the list, but the turn is the Lurker's.
    expect(st.combatants.map((c: any) => c.name)).toEqual(["Goblin", "Lyra"]);
    st = (await emit(b.s.dm, "combat:next", { campaignId: b.id })).data;
    expect(st).toMatchObject({ round: 2, activeCombatantId: ids.Goblin });
    st = (await emit(b.s.dm, "combat:prev", { campaignId: b.id })).data;
    expect(st).toMatchObject({ round: 1, activeCombatantId: ids.Lurker });

    await tick();
    expect(last(bobState).combat.round).toBe(1);
    expect((await emit(b.s.dm, "combat:end", { campaignId: b.id })).data).toBeNull();
    await tick();
    expect(last(bobState).combat).toBeNull();
  });

  it("applies damage with resistances, temp HP and healing, and marks defeated monsters", async () => {
    const b = await battle();
    await emit(b.s.dm, "combat:start", b.ref);
    const bobTokens = collect(b.s.bob, "token:upsert");
    const dmTokens = collect(b.s.dm, "token:upsert");

    const fire = await emit(b.s.dm, "token:hp", { campaignId: b.id, tokenId: b.goblin.id, action: { kind: "damage", amount: 5, damageType: "fire" } });
    expect(fire.data).toMatchObject({ effective: 2, notes: ["resistant to fire"] });
    expect(fire.data.token.vitals.hp.current).toBe(5);
    await tick();
    // Bob sees the token update but not its HP (gm-only vitals).
    expect(last(bobTokens)).toMatchObject({ id: b.goblin.id, vitals: null, vitalsHidden: true });
    expect(last(dmTokens).vitals.hp.current).toBe(5);

    // Players can't hurt monsters they don't own, or set HP.
    expect((await emit(b.s.alice, "token:hp", { campaignId: b.id, tokenId: b.goblin.id, action: { kind: "damage", amount: 5 } })).error).toMatch(/your own/);
    expect((await emit(b.s.alice, "token:hp", { campaignId: b.id, tokenId: b.pcToken.id, action: { kind: "set", current: 999 } })).error).toMatch(/Only the DM/);

    const down = await emit(b.s.dm, "token:hp", { campaignId: b.id, tokenId: b.goblin.id, action: { kind: "damage", amount: 10 } });
    expect(down.data.token.vitals.hp.current).toBe(0);
    const st = (await emit(b.s.dm, "combat:get", { campaignId: b.id })).data;
    expect(st.combatants.find((c: any) => c.name === "Goblin").defeated).toBe(true);

    // PC HP lives on the character sheet: temp HP absorbs first, then the sheet updates for everyone.
    const max = b.pcToken.vitals.hp.max;
    expect((await emit(b.s.alice, "token:hp", { campaignId: b.id, tokenId: b.pcToken.id, action: { kind: "temp", amount: 3 } })).ok).toBe(true);
    const aliceChars = collect(b.s.alice, "character:changed");
    const hit = await emit(b.s.dm, "token:hp", { campaignId: b.id, tokenId: b.pcToken.id, action: { kind: "damage", amount: 5 } });
    expect(hit.data.token.vitals.hp).toEqual({ current: max - 2, max, temp: 0 });
    await tick();
    expect(aliceChars.map((c) => c.characterId)).toContain(b.pc.id);
    const sheet = (await b.alice.client.get(`/api/characters/${b.pc.id}`)).json().character;
    expect(sheet.data.hp).toEqual({ current: max - 2, max, temp: 0 });
    const healed = await emit(b.s.alice, "token:hp", { campaignId: b.id, tokenId: b.pcToken.id, action: { kind: "heal", amount: 50 } });
    expect(healed.data.token.vitals.hp.current).toBe(max);
    // Bob (the other player) sees the PC's HP since PCs default to "everyone".
    await tick();
    expect(last(bobTokens.filter((t) => t.id === b.pcToken.id)).vitals.hp.current).toBe(max);

    // Editing the sheet over REST re-broadcasts the linked token.
    const before = bobTokens.length;
    const latest = (await b.alice.client.get(`/api/characters/${b.pc.id}`)).json().character;
    expect(latest.version).toBe(sheet.version + 1);
    const put = await b.alice.client.put(`/api/characters/${b.pc.id}`, { expectedVersion: latest.version, data: { ...latest.data, hp: { current: 1, max, temp: 0 } } });
    expect(put.statusCode).toBe(200);
    await tick(250);
    expect(bobTokens.slice(before).some((t) => t.id === b.pcToken.id && t.vitals?.hp.current === 1)).toBe(true);
  });

  it("tracks conditions with durations that expire at the end of the creature's turn", async () => {
    const b = await battle();
    const started = (await emit(b.s.dm, "combat:start", { ...b.ref, tokenIds: [b.goblin.id, b.pcToken.id] })).data;
    expect(started.combatants).toHaveLength(2);
    const ids = Object.fromEntries(started.combatants.map((c: any) => [c.name, c.id]));
    await emit(b.s.dm, "combat:setInitiative", { campaignId: b.id, combatantId: ids.Goblin, value: 18 });
    await emit(b.s.dm, "combat:setInitiative", { campaignId: b.id, combatantId: ids.Lyra, value: 3 });

    expect((await emit(b.s.dm, "token:conditions", { campaignId: b.id, tokenId: b.goblin.id, conditions: [{ id: "made-up", durationRounds: null }] })).error).toMatch(/Unknown condition/);
    const set = await emit(b.s.dm, "token:conditions", {
      campaignId: b.id,
      tokenId: b.goblin.id,
      conditions: [{ id: "frightened", durationRounds: 1 }, { id: "prone", durationRounds: null }],
    });
    expect(set.data.vitals.conditions.map((c: any) => c.id)).toEqual(["frightened", "prone"]);
    await emit(b.s.alice, "token:conditions", { campaignId: b.id, tokenId: b.pcToken.id, conditions: [{ id: "blinded", durationRounds: 2 }] });

    await emit(b.s.dm, "combat:next", { campaignId: b.id }); // Goblin's turn starts
    await emit(b.s.dm, "combat:next", { campaignId: b.id }); // Goblin's turn ends → frightened expires
    let gob = (await emit(b.s.dm, "token:hp", { campaignId: b.id, tokenId: b.goblin.id, action: { kind: "heal", amount: 0 } })).data.token;
    expect(gob.vitals.conditions.map((c: any) => c.id)).toEqual(["prone"]);
    await emit(b.s.alice, "combat:next", { campaignId: b.id }); // Lyra's turn ends → blinded 2 → 1
    const sheet = (await b.alice.client.get(`/api/characters/${b.pc.id}`)).json().character;
    expect(sheet.data.conditions).toEqual([expect.objectContaining({ id: "blinded", durationRounds: 1 })]);

    // A token-less combatant can be added and removed while it's their turn.
    const st = (await emit(b.s.dm, "combat:addCustom", { campaignId: b.id, name: "Spirit Guardians", initiativeBonus: 0 })).data;
    const spirit = st.combatants.find((c: any) => c.name === "Spirit Guardians");
    expect(spirit.tokenId).toBeNull();
    const removed = (await emit(b.s.dm, "combat:remove", { campaignId: b.id, combatantId: spirit.id })).data;
    expect(removed.combatants).toHaveLength(2);
    gob = removed.combatants.find((c: any) => c.name === "Goblin");
    expect(removed.activeCombatantId).toBe(gob.id);
  });
});
