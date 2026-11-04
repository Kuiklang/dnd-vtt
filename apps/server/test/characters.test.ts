import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCampaign, registerUser, setupApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => (ctx = await setupApp({ realtime: false })));
afterAll(() => ctx.close());

const fighter = {
  classes: [{ name: "Fighter", level: 3, hitDie: 10 }],
  species: "Dwarf",
  abilities: { str: 16, dex: 12, con: 15, int: 8, wis: 10, cha: 10 },
  hp: { max: 28, current: 28, temp: 0 },
  notes: { backstory: "Secret past" },
};

describe("characters", () => {
  it("creates, reads, updates with optimistic locking, and soft-deletes", async () => {
    const { client } = await registerUser(ctx.app);
    const res = await client.post("/api/characters", { name: "Thorin", rulesetId: "dnd5e-2014", data: fighter });
    expect(res.statusCode).toBe(201);
    const c = res.json().character;
    expect(c).toMatchObject({ name: "Thorin", kind: "pc", version: 1, access: "owner" });
    expect(c.data.abilities.str).toBe(16);
    expect(c.data.spellcasting.slots).toHaveLength(9);

    const upd = await client.put(`/api/characters/${c.id}`, { expectedVersion: 1, data: { ...c.data, hp: { max: 28, current: 20, temp: 0 } } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().character).toMatchObject({ version: 2, data: { hp: { current: 20 } } });

    const stale = await client.put(`/api/characters/${c.id}`, { expectedVersion: 1, name: "Stale" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.currentVersion).toBe(2);

    expect((await client.get("/api/characters")).json().characters).toHaveLength(1);
    expect((await client.del(`/api/characters/${c.id}`)).statusCode).toBe(200);
    expect((await client.get(`/api/characters/${c.id}`)).statusCode).toBe(404);
    expect((await client.get("/api/characters")).json().characters).toHaveLength(0);
  });

  it("validates sheet data", async () => {
    const { client } = await registerUser(ctx.app);
    const bad = await client.post("/api/characters", { name: "Bad", rulesetId: "dnd5e-2024", data: { abilities: { str: 99 } } });
    expect(bad.statusCode).toBe(400);
    const badFormula = await client.post("/api/characters", {
      name: "Bad",
      rulesetId: "dnd5e-2024",
      data: { attacks: [{ id: "a", name: "Evil", damage: "require('fs')" }] },
    });
    expect(badFormula.statusCode).toBe(400);
    expect((await client.post("/api/characters", { name: "X", rulesetId: "nope" })).statusCode).toBe(400);
  });

  it("duplicates and round-trips JSON export/import", async () => {
    const { client } = await registerUser(ctx.app);
    const c = (await client.post("/api/characters", { name: "Lyra", rulesetId: "dnd5e-2024", data: fighter })).json().character;
    const dup = (await client.post(`/api/characters/${c.id}/duplicate`)).json().character;
    expect(dup.name).toBe("Lyra (copy)");
    expect(dup.id).not.toBe(c.id);

    const exp = await client.get(`/api/characters/${c.id}/export`);
    expect(exp.headers["content-disposition"]).toMatch(/Lyra\.json/);
    const file = exp.json();
    expect(file).toMatchObject({ format: "vtt-character", schemaVersion: 1, character: { name: "Lyra" } });

    const imp = await client.post("/api/characters/import", { file });
    expect(imp.statusCode).toBe(201);
    expect(imp.json().character.data).toEqual(c.data);
    expect((await client.post("/api/characters/import", { file: { hello: "world" } })).statusCode).toBe(400);
  });

  it("enforces per-campaign character privacy", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id: campaignId, code } = await createCampaign(dm, { rulesetId: "dnd5e-2014" });
    const { client: alice, user: aliceUser } = await registerUser(ctx.app);
    const { client: bob } = await registerUser(ctx.app);
    const { client: stranger } = await registerUser(ctx.app);
    await alice.post(`/api/invitations/${code}/accept`);
    await bob.post(`/api/invitations/${code}/accept`);

    const thorin = (await alice.post("/api/characters", { name: "Thorin", rulesetId: "dnd5e-2014", data: fighter })).json().character;
    // Before selection, nobody else can see it.
    expect((await dm.get(`/api/characters/${thorin.id}`)).statusCode).toBe(404);

    // Ruleset must match the campaign.
    const wrong = (await alice.post("/api/characters", { name: "Wrong", rulesetId: "dnd5e-2024" })).json().character;
    expect((await alice.put(`/api/campaigns/${campaignId}/character`, { characterId: wrong.id })).statusCode).toBe(400);
    // Can't select someone else's character.
    expect((await bob.put(`/api/campaigns/${campaignId}/character`, { characterId: thorin.id })).statusCode).toBe(404);
    expect((await alice.put(`/api/campaigns/${campaignId}/character`, { characterId: thorin.id })).statusCode).toBe(200);

    const detail = (await dm.get(`/api/campaigns/${campaignId}`)).json();
    const am = detail.members.find((m: { userId: string }) => m.userId === aliceUser.id);
    expect(am.character).toMatchObject({ name: "Thorin", summary: "Dwarf · Fighter 3" });

    // DM sees and can edit the full sheet; party member sees only a summary; stranger sees nothing.
    const dmView = (await dm.get(`/api/characters/${thorin.id}`)).json().character;
    expect(dmView.access).toBe("edit");
    expect(dmView.data.notes.backstory).toBe("Secret past");
    const bobView = (await bob.get(`/api/characters/${thorin.id}`)).json().character;
    expect(bobView.access).toBe("summary");
    expect(bobView.data).toBeUndefined();
    expect(JSON.stringify(bobView)).not.toMatch(/Secret past/);
    expect((await stranger.get(`/api/characters/${thorin.id}`)).statusCode).toBe(404);
    expect((await bob.put(`/api/characters/${thorin.id}`, { expectedVersion: 1, name: "Hijacked" })).statusCode).toBe(403);
    expect((await bob.get(`/api/characters/${thorin.id}/export`)).statusCode).toBe(403);

    const dmEdit = await dm.put(`/api/characters/${thorin.id}`, { expectedVersion: 1, data: { ...dmView.data, inspiration: true } });
    expect(dmEdit.statusCode).toBe(200);
    expect((await dm.del(`/api/characters/${thorin.id}`)).statusCode).toBe(403);
  });

  it("lets DMs create NPCs and controls player visibility", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id: campaignId, code } = await createCampaign(dm);
    const { client: p } = await registerUser(ctx.app);
    await p.post(`/api/invitations/${code}/accept`);

    expect((await p.post("/api/characters", { name: "Fake NPC", kind: "npc", rulesetId: "dnd5e-2024", campaignId })).statusCode).toBe(403);
    const npc = (
      await dm.post("/api/characters", { name: "Strahd", kind: "npc", rulesetId: "dnd5e-2024", campaignId, data: { notes: { personal: "Is the villain" } } })
    ).json().character;
    expect(npc.access).toBe("edit");
    expect((await dm.get(`/api/campaigns/${campaignId}/characters`)).json().characters).toHaveLength(1);
    expect((await p.get(`/api/campaigns/${campaignId}/characters`)).json().characters).toHaveLength(0);
    expect((await p.get(`/api/characters/${npc.id}`)).statusCode).toBe(404);

    await dm.put(`/api/characters/${npc.id}`, { expectedVersion: 1, playerVisible: true });
    const visible = (await p.get(`/api/campaigns/${campaignId}/characters`)).json().characters;
    expect(visible).toHaveLength(1);
    expect(visible[0].access).toBe("summary");
    expect(JSON.stringify(visible)).not.toMatch(/villain/);
  });
});
