import { deflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { pngBytes, registerUser, setupApp, upload } from "./helpers.js";
import { tokens as tokensTable } from "../src/db/schema.js";
import { readZip } from "../src/packs/zip.js";

/** Builds a .zip (deflate for text, stored for the rest); CRCs are not checked by the reader. */
function makeZip(entries: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const cens: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const deflate = !Buffer.isBuffer(content);
    const comp = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, "utf8");
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(0x800, 6);
    loc.writeUInt16LE(deflate ? 8 : 0, 8);
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(data.length, 22);
    loc.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(loc, nameBuf, comp);
    cens.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(cens);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, eocd]);
}

const goblin = {
  ac: 15,
  hp: 7,
  hitDice: "2d6",
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  senses: "darkvision 60 ft., passive Perception 9",
  cr: "1/4",
  xp: 50,
  actions: [{ name: "Scimitar", description: "Melee", attackBonus: 4, damage: "1d6+2", damageType: "slashing" }],
};

function pack(overrides: Record<string, unknown> = {}) {
  return {
    format: "vtt-campaign-pack",
    version: 1,
    campaign: { name: "Pack Test", description: "Imported" },
    assets: [{ id: "cave", file: "maps/cave.png", kind: "map" }],
    statBlocks: [
      { id: "goblin", kind: "monster", name: "Goblin", monster: goblin },
      {
        id: "chest",
        kind: "npc",
        name: "Chest",
        monster: { ...goblin, ac: 11, hp: 10, actions: [] },
        inventory: [{ name: "Potion of Healing", quantity: 2 }],
        currency: { gp: 25 },
      },
    ],
    scenes: [
      {
        name: "Cave",
        map: "cave",
        grid: { size: 50 },
        tokens: [
          { name: "Goblin 1", statBlock: "goblin", cell: [1, 2], hidden: true },
          { name: "Chest", statBlock: "chest", linked: true, cell: [3, 3], layer: "objects" },
          { name: "Marker", cell: [0, 0] },
        ],
      },
      { name: "Blank", cols: 10, rows: 8 },
    ],
    journal: [{ title: "Intro", body: "> Read aloud", folder: "Part 1" }],
    encounters: [{ name: "Ambush", entries: [{ statBlock: "goblin", count: 3 }] }],
    tables: [{ name: "Weather", formula: "1d4", entries: [{ min: 1, max: 2, text: "Snow" }, { min: 3, max: 4, text: "Clear" }] }],
    ...overrides,
  };
}

describe("campaign packs", () => {
  let ctx: Awaited<ReturnType<typeof setupApp>>;
  beforeAll(async () => {
    ctx = await setupApp();
  });
  afterAll(async () => ctx.close());

  it("reads back what the zip writer stored", () => {
    const files = readZip(makeZip({ "a/b.txt": "hello", "c.bin": Buffer.from([1, 2, 3]) }), { maxEntries: 10, maxTotalBytes: 1000, maxEntryBytes: 1000 });
    expect(files.get("a/b.txt")?.toString()).toBe("hello");
    expect([...files.get("c.bin")!]).toEqual([1, 2, 3]);
  });

  it("imports a pack into a new campaign the importer runs", async () => {
    const { client } = await registerUser(ctx.app);
    const zip = makeZip({ "My Pack/campaign.json": JSON.stringify(pack()), "My Pack/maps/cave.png": pngBytes(500, 400) });
    const res = await upload(ctx.app, client, {}, zip, "pack.zip", "/api/campaigns/import");
    expect(res.statusCode, res.body).toBe(201);
    const summary = res.json().summary;
    expect(summary).toMatchObject({ name: "Pack Test", scenes: 2, tokens: 3, statBlocks: 2, journal: 1, encounters: 1, tables: 1, assets: 1 });
    const id = summary.campaignId as string;

    const scenes = (await client.get(`/api/campaigns/${id}/scenes`)).json();
    expect(scenes.scenes).toHaveLength(2);
    const cave = scenes.scenes.find((s: { name: string }) => s.name === "Cave");
    expect(scenes.activeSceneId).toBe(cave.id);
    expect(cave.width).toBe(500);
    const blank = scenes.scenes.find((s: { name: string }) => s.name === "Blank");
    expect(blank.width).toBe(10 * 70);

    const toks = await ctx.db.select().from(tokensTable).where(eq(tokensTable.sceneId, cave.id));
    const gob = toks.find((t) => t.name === "Goblin 1")!;
    expect(gob.x).toBe(75);
    expect(gob.y).toBe(125);
    expect(gob.hidden).toBe(true);
    expect(toks.find((t) => t.name === "Chest")!.characterId).toBeTruthy();

    const chars = (await client.get(`/api/campaigns/${id}/characters`)).json().characters as { name: string; data: { inventory: { name: string }[]; currency: { gp: number } } }[];
    const chest = chars.find((c) => c.name === "Chest")!;
    expect(chest.data.inventory.map((i) => i.name)).toContain("Potion of Healing");
    expect(chest.data.currency.gp).toBe(25);

    expect((await client.get(`/api/campaigns/${id}/journal`)).json().entries).toHaveLength(1);
    expect((await client.get(`/api/campaigns/${id}/encounters`)).statusCode).toBe(200);
  });

  it("rejects packs with broken references and leaves nothing behind", async () => {
    const { client } = await registerUser(ctx.app);
    const bad = pack({ encounters: [{ name: "x", entries: [{ statBlock: "dragon", count: 1 }] }] });
    const res = await upload(ctx.app, client, {}, makeZip({ "campaign.json": JSON.stringify(bad), "maps/cave.png": pngBytes(500, 400) }), "pack.zip", "/api/campaigns/import");
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("dragon");
    const list = (await client.get("/api/campaigns")).json();
    expect(JSON.stringify(list)).not.toContain("Pack Test");
  });

  it("rejects a missing manifest, a missing image and non-zip uploads", async () => {
    const { client } = await registerUser(ctx.app);
    const noManifest = await upload(ctx.app, client, {}, makeZip({ "readme.txt": "hi" }), "p.zip", "/api/campaigns/import");
    expect(noManifest.statusCode).toBe(400);
    const noImage = await upload(ctx.app, client, {}, makeZip({ "campaign.json": JSON.stringify(pack()) }), "p.zip", "/api/campaigns/import");
    expect(noImage.statusCode).toBe(400);
    expect(noImage.body).toContain("cave.png");
    const notZip = await upload(ctx.app, client, {}, Buffer.from("not a zip at all, just text padding......"), "p.zip", "/api/campaigns/import");
    expect(notZip.statusCode).toBe(400);
  });
});
