import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyExtractedSheet, type ExtractedSheet } from "@vtt/rules";
import { pngBytes, registerUser, setupApp, upload } from "./helpers.js";
import type { SheetExtractor, SheetFile } from "../src/import/extractor.js";

/** Stands in for the Claude reader: records what it was given and returns a fixed draft. */
class FakeExtractor implements SheetExtractor {
  readonly name = "fake";
  calls: Array<{ file: SheetFile; hint: { rulesetName: string } }> = [];
  async extract(file: SheetFile, hint: { rulesetName: string }): Promise<ExtractedSheet> {
    this.calls.push({ file, hint });
    return { ...emptyExtractedSheet("Lyra"), classes: [{ name: "Wizard", subclass: null, level: 3 }], maxHp: 17, uncertainFields: ["maxHp"] };
  }
}

const fake = new FakeExtractor();
let ctx: Awaited<ReturnType<typeof setupApp>>;
let off: Awaited<ReturnType<typeof setupApp>>;
const pdf = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const url = "/api/characters/import/sheet";

beforeAll(async () => {
  ctx = await setupApp({ realtime: false, sheetExtractor: fake }, { IMPORT_PER_HOUR: "3" });
});
afterAll(async () => {
  await ctx.close();
  await off?.close();
});

describe("character sheet import", () => {
  it("reads PDFs and images into a draft without saving anything", async () => {
    const u = await registerUser(ctx.app);
    expect((await u.client.get(url)).json()).toMatchObject({ available: true });
    const res = await upload(ctx.app, u.client, { rulesetId: "dnd5e-2024" }, pdf, "sheet.pdf", url);
    expect(res.statusCode).toBe(200);
    expect(res.json().draft).toMatchObject({ name: "Lyra", maxHp: 17, uncertainFields: ["maxHp"] });
    expect(fake.calls.at(-1)).toMatchObject({ file: { mime: "application/pdf" }, hint: { rulesetName: "D&D 5e (2024 Revised)" } });
    const img = await upload(ctx.app, u.client, {}, pngBytes(40, 40), "photo.png", url);
    expect(img.statusCode).toBe(200);
    expect(fake.calls.at(-1)!.file.mime).toBe("image/png");
    expect((await u.client.get("/api/characters")).json().characters).toHaveLength(0);
  });

  it("rejects other files, anonymous users and too many imports", async () => {
    const u = await registerUser(ctx.app);
    const html = await upload(ctx.app, u.client, {}, Buffer.from("<html><body>not a sheet</body></html>"), "x.pdf", url);
    expect(html.statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "GET", url })).statusCode).toBe(401);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await upload(ctx.app, u.client, {}, pdf, "s.pdf", url)).statusCode);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("says clearly when no API key is configured", async () => {
    off = await setupApp({ realtime: false, sheetExtractor: null });
    const u = await registerUser(off.app);
    expect((await u.client.get(url)).json()).toMatchObject({ available: false });
    const res = await upload(off.app, u.client, {}, pdf, "s.pdf", url);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/ANTHROPIC_API_KEY/);
  });
});
