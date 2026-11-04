import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { spellSheetEntry, getSrdSpell } from "@vtt/rules";
import { createCampaign, registerUser, setupApp } from "./helpers.js";
import { draftRecap } from "../src/timeline/service.js";

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

const wizard = (spells: unknown[]) => ({
  classes: [{ name: "Wizard", level: 5, hitDie: 6 }],
  abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  hp: { max: 30, current: 30, temp: 0 },
  spellcasting: {
    ability: "int",
    slots: [{ max: 4, used: 0 }, { max: 3, used: 0 }, { max: 2, used: 0 }, ...Array.from({ length: 6 }, () => ({ max: 0, used: 0 }))],
    spells,
  },
});

async function table() {
  const dm = await registerUser(ctx.app);
  const { id, code } = await createCampaign(dm.client, { rulesetId: "dnd5e-2014" });
  const alice = await registerUser(ctx.app);
  const bob = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  await bob.client.post(`/api/invitations/${code}/accept`);
  const elara = (
    await alice.client.post("/api/characters", {
      name: "Elara",
      rulesetId: "dnd5e-2014",
      data: wizard([spellSheetEntry(getSrdSpell("bless")!, "s-bless"), spellSheetEntry(getSrdSpell("hold-person")!, "s-hold"), spellSheetEntry(getSrdSpell("fire-bolt")!, "s-bolt")]),
    })
  ).json().character;
  await alice.client.put(`/api/campaigns/${id}/character`, { characterId: elara.id });
  return { id, dm, alice, bob, elara };
}

const chat = async (c: { get(url: string): Promise<{ json(): any }> }, id: string) => ((await c.get(`/api/campaigns/${id}/chat`)).json().messages as any[]).map((m) => m.content);

describe("concentration", () => {
  it("starts on cast, swaps on a new spell, asks for a Con save on damage and ends at 0 HP", async () => {
    const { id, dm, alice, bob, elara } = await table();
    const sheet = async () => (await alice.client.get(`/api/characters/${elara.id}`)).json().character.data;
    const cast = (body: unknown) => alice.client.post(`/api/campaigns/${id}/characters/${elara.id}/cast`, body);

    expect((await sheet()).concentration).toBeNull();
    expect((await cast({ spellId: "s-bless", slotLevel: 1 })).json().changed).toBe(true);
    expect((await sheet()).concentration).toMatchObject({ spell: "Bless", spellId: "s-bless" });
    // Cantrips without concentration leave it alone.
    await cast({ spellId: "s-bolt" });
    expect((await sheet()).concentration.spell).toBe("Bless");
    // A second concentration spell replaces the first, and the log says so.
    await cast({ spellId: "s-hold", slotLevel: 2 });
    expect((await sheet()).concentration.spell).toBe("Hold Person");
    expect(await chat(alice.client, id)).toContain("Elara stops concentrating on Bless");

    // Damage to her token: the log asks for the save with DC max(10, half).
    const scene = (await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Road", width: 1000, height: 1000 })).json().scene;
    const ds = await open(dm.client.cookie);
    const as = await open(alice.client.cookie);
    const ref = { campaignId: id, sceneId: scene.id };
    for (const s of [ds, as]) await emit(s, "scene:join", ref);
    const token = (await emit(as, "token:create", { ...ref, token: { characterId: elara.id, x: 100, y: 100 } })).data;
    const hit = await emit(ds, "token:hp", { campaignId: id, tokenId: token.id, action: { kind: "damage", amount: 24 } });
    expect(hit.data.concentration).toEqual({ name: "Elara", spell: "Hold Person", dc: 12, ended: false });
    await emit(ds, "token:hp", { campaignId: id, tokenId: token.id, action: { kind: "damage", amount: 3 } });
    const log = await chat(alice.client, id);
    expect(log).toContain("Elara must make a DC 12 Constitution save to keep concentrating on Hold Person");
    expect(log).toContain("Elara must make a DC 10 Constitution save to keep concentrating on Hold Person");
    expect((await sheet()).concentration.spell).toBe("Hold Person");

    // Only her controller or the DM can end it.
    expect((await bob.client.post(`/api/campaigns/${id}/characters/${elara.id}/concentration/end`)).statusCode).toBe(403);
    expect((await dm.client.post(`/api/campaigns/${id}/characters/${elara.id}/concentration/end`)).json().ended).toBe("Hold Person");
    expect((await sheet()).concentration).toBeNull();
    expect((await alice.client.post(`/api/campaigns/${id}/characters/${elara.id}/concentration/end`)).json().ended).toBeNull();

    // Dropping to 0 HP ends it outright.
    await cast({ spellId: "s-bless", slotLevel: 1 });
    const down = await emit(ds, "token:hp", { campaignId: id, tokenId: token.id, action: { kind: "damage", amount: 50 } });
    expect(down.data.concentration).toMatchObject({ spell: "Bless", ended: true });
    expect((await sheet()).concentration).toBeNull();
    expect(await chat(alice.client, id)).toContain("Elara drops to 0 HP and loses concentration on Bless");
  });

  it("announces a DM's hidden cast to the DM only", async () => {
    const { id, dm, alice } = await table();
    const npc = (
      await dm.client.post("/api/characters", { name: "Cult Mage", rulesetId: "dnd5e-2014", campaignId: id, kind: "npc", data: wizard([spellSheetEntry(getSrdSpell("hold-person")!, "h")]) })
    ).json().character;
    const r = await dm.client.post(`/api/campaigns/${id}/characters/${npc.id}/cast`, { spellId: "h", slotLevel: 2, visibility: "dm_only" });
    expect(r.statusCode).toBe(200);
    expect((await chat(dm.client, id)).some((c) => c.startsWith("Cult Mage casts Hold Person"))).toBe(true);
    expect((await chat(alice.client, id)).some((c) => c.includes("Cult Mage"))).toBe(false);
  });
});

describe("session recaps and timeline", () => {
  it("drafts a recap from the public log, keeps it private until published", async () => {
    const { id, dm, alice } = await table();
    const session = (await dm.client.post(`/api/campaigns/${id}/session/start`, { name: "The Burning Mill" })).json().session;
    await alice.client.post(`/api/campaigns/${id}/characters/${(await alice.client.get(`/api/campaigns/${id}`)).json().me.activeCharacterId}/cast`, { spellId: "s-bolt" });
    await dm.client.post(`/api/campaigns/${id}/chat`, { content: "secret note", channel: "dm" });
    await dm.client.post(`/api/campaigns/${id}/session/end`);

    expect((await alice.client.get(`/api/campaigns/${id}/sessions/${session.id}/recap-draft`)).statusCode).toBe(403);
    const draft = (await dm.client.get(`/api/campaigns/${id}/sessions/${session.id}/recap-draft`)).json().draft as string;
    expect(draft).toMatch(/^Session 1: The Burning Mill/);
    expect(draft).toContain("- Elara casts Fire Bolt");
    expect(draft).toContain("- The Burning Mill has ended");
    expect(draft).toMatch(/- 2 rolls: Elara 2/);
    expect(draft).not.toContain("secret");

    // Saved but unpublished: players get the session without its recap.
    expect((await alice.client.patch(`/api/campaigns/${id}/sessions/${session.id}`, { recap: "x" })).statusCode).toBe(403);
    await dm.client.patch(`/api/campaigns/${id}/sessions/${session.id}`, { recap: "The mill burned. Elara saved the miller." });
    let tl = (await alice.client.get(`/api/campaigns/${id}/timeline`)).json();
    expect(tl.sessions[0]).toMatchObject({ number: 1, name: "The Burning Mill", recap: "", recapPublished: false });
    expect((await dm.client.get(`/api/campaigns/${id}/timeline`)).json().sessions[0].recap).toBe("The mill burned. Elara saved the miller.");
    await dm.client.patch(`/api/campaigns/${id}/sessions/${session.id}`, { recapPublished: true });
    tl = (await alice.client.get(`/api/campaigns/${id}/timeline`)).json();
    expect(tl.sessions[0].recap).toBe("The mill burned. Elara saved the miller.");
  });

  it("keeps DM-only story events from players and validates links", async () => {
    const { id, dm, alice } = await table();
    const session = (await dm.client.post(`/api/campaigns/${id}/session/start`, {})).json().session;
    const add = (body: unknown) => dm.client.post(`/api/campaigns/${id}/timeline-events`, body);
    const pub = (await add({ title: "The mill burns", inWorldDate: "Day 3 of Frostfall", sessionId: session.id })).json().event;
    const secret = (await add({ title: "The baron hires the cult", visibility: "dm" })).json().event;
    expect(pub.sortKey).toBeLessThan(secret.sortKey);
    expect((await add({ title: "x", sessionId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
    expect((await add({ title: "" })).statusCode).toBe(400);
    expect((await alice.client.post(`/api/campaigns/${id}/timeline-events`, { title: "mine" })).statusCode).toBe(403);

    const forAlice = (await alice.client.get(`/api/campaigns/${id}/timeline`)).json().events;
    expect(forAlice.map((e: any) => e.title)).toEqual(["The mill burns"]);
    expect(forAlice[0]).not.toHaveProperty("visibility");
    expect((await dm.client.get(`/api/campaigns/${id}/timeline`)).json().events).toHaveLength(2);

    // Revealing the secret shows it to players; deleting removes it.
    await dm.client.patch(`/api/campaigns/${id}/timeline-events/${secret.id}`, { visibility: "players" });
    expect((await alice.client.get(`/api/campaigns/${id}/timeline`)).json().events).toHaveLength(2);
    expect((await dm.client.req("DELETE", `/api/campaigns/${id}/timeline-events/${secret.id}`)).statusCode).toBe(204);
    expect((await dm.client.req("DELETE", `/api/campaigns/${id}/timeline-events/${secret.id}`)).statusCode).toBe(404);
  });

  it("writes a readable draft even from an empty session", () => {
    const d = draftRecap({ session: { number: 2, name: "Quiet night", startedAt: new Date("2026-11-01T18:00:00Z"), endedAt: null }, notices: ["Bram joined the campaign."], rolls: [] });
    expect(d).toContain("Session 2: Quiet night");
    expect(d).toContain("Played 2026-11-01");
    expect(d).toContain("Nothing was logged");
    expect(d).not.toContain("Bram joined");
    const crit = draftRecap({
      session: { number: 1, name: "A", startedAt: new Date(), endedAt: null },
      notices: [],
      rolls: [
        { who: "Elara", label: "Fire Bolt — spell attack", total: 22, rollType: "attack", critical: true, fumble: false },
        { who: "Elara", label: "Fire Bolt — fire damage", total: 14, rollType: "damage", critical: false, fumble: false },
        { who: "Bram", label: "Athletics", total: 2, rollType: "skill", critical: false, fumble: true },
      ],
    });
    expect(crit).toContain("- 3 rolls: Elara 2, Bram 1");
    expect(crit).toContain("- Biggest hit: 14 (Fire Bolt — fire damage, Elara)");
    expect(crit).toContain("- Natural 20s: Elara (Fire Bolt — spell attack)");
    expect(crit).toContain("- Natural 1s: Bram (Athletics)");
  });
});
