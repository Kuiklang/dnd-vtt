/**
 * Phase 3 browser walkthrough: character sheet import (PDF/photo → review → save) and
 * the guided SRD character creator.
 * The real server runs without ANTHROPIC_API_KEY, so first we check the page says so;
 * then the extraction response is stubbed in the browser (the Claude call itself is covered
 * by the server's provider interface + integration tests) to exercise review and save
 * against the real API.
 * Usage: BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase3.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS;
const uniq = Date.now().toString(36);
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

const DRAFT = {
  name: "Kestrel Vane",
  playerName: "Bram",
  species: "Half-Elf",
  background: "Criminal",
  alignment: "CN",
  classes: [{ name: "Rogue", subclass: "Thief", level: 4 }],
  abilities: { str: 10, dex: 18, con: 14, int: 12, wis: null, cha: 14 },
  savingThrowProficiencies: ["dex", "int"],
  skillProficiencies: [{ skill: "Stealth", level: "expertise" }, { skill: "Perception", level: "proficient" }],
  armorClass: 15,
  maxHp: 31,
  currentHp: 31,
  tempHp: null,
  speed: 30,
  xp: 2700,
  attacks: [{ name: "Shortsword", attackBonus: 6, damage: "1d6+4", damageType: "piercing" }],
  features: [{ name: "Sneak Attack", description: "2d6 extra damage once per turn." }],
  spells: [],
  inventory: [{ name: "Thieves' tools", quantity: 1 }],
  currency: { cp: 0, sp: 4, ep: null, gp: 37, pp: null },
  notes: { personality: null, ideals: null, bonds: null, flaws: null, backstory: "Grew up on the docks." },
  uncertainFields: ["abilities.wis", "maxHp"],
  warnings: ["The bottom of the page was cut off."],
};

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto(`${BASE}/login`);
  await page.evaluate(async (u) => {
    const r = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `p3${u}@example.com`, username: `p3${u}`, password: "a-strong-password", displayName: "Bram" }) });
    if (!r.ok) throw new Error(await r.text());
  }, uniq);

  // 1) No sheet reader on this server: the page says so plainly and the button is disabled.
  //    (Stubbed, so the check holds whether or not the server has AI set up.)
  await page.route("**/api/characters/import/sheet", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { available: false, maxBytes: 10485760 } }) : route.continue(),
  );
  await page.goto(`${BASE}/`);
  await page.getByTestId("import-sheet-link").click();
  await page.waitForURL(/\/characters\/import$/);
  await page.getByTestId("import-unavailable").waitFor();
  assert.ok(await page.getByTestId("read-sheet").isDisabled());
  await shot(page, "p3-01-import-unavailable");
  await page.unroute("**/api/characters/import/sheet");

  // 2) Stub the reader and go through review → save against the real API.
  await page.route("**/api/characters/import/sheet", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true, maxBytes: 10485760 } });
    assert.match(route.request().headers()["content-type"], /multipart\/form-data/);
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ json: { draft: DRAFT, rulesetId: "dnd5e-2014" } });
  });
  await page.reload();
  await page.getByTestId("sheet-file").setInputFiles(path.join(__dirname, "fixtures/ogre.png"));
  await page.getByTestId("read-sheet").click();
  await page.getByTestId("import-review").waitFor();
  await page.getByTestId("uncertain-count").getByText("2").waitFor();
  assert.equal(await page.locator("[data-uncertain]").count() >= 2, true, "uncertain fields highlighted");
  await page.getByText("The bottom of the page was cut off.").waitFor();
  await page.getByText("WIS wasn't read; set to 10").waitFor();
  // Calculated preview: level 4 → proficiency +2, DEX 18 → initiative +4.
  await page.getByText("proficiency +2, initiative +4").waitFor();
  await shot(page, "p3-02-import-review");
  // Fix the unread WIS and the HP.
  await page.getByTestId("import-ability-wis").fill("13");
  await page.getByTestId("import-maxHp").fill("32");
  await page.getByTestId("import-save").click();
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop();
  const c = await page.evaluate(async (id) => (await (await fetch(`/api/characters/${id}`)).json()).character, id);
  assert.equal(c.name, "Kestrel Vane");
  assert.equal(c.rulesetId, "dnd5e-2014");
  assert.deepEqual(c.data.abilities, { str: 10, dex: 18, con: 14, int: 12, wis: 13, cha: 14 });
  assert.deepEqual(c.data.hp, { max: 32, current: 31, temp: 0 });
  assert.deepEqual(c.data.skills, { stealth: "expertise", perception: "proficient" });
  assert.equal(c.data.attacks[0].attackBonusOverride, 6);
  assert.equal(c.data.classes[0].hitDie, 8);
  await page.getByText("Kestrel Vane").first().waitFor();
  await shot(page, "p3-03-imported-sheet");

  // 3) Guided creator (5e 2014, SRD 5.1): Hill Dwarf Life cleric, Acolyte.
  await page.goto(`${BASE}/`);
  await page.getByTestId("create-guided-link").click();
  await page.waitForURL(/\/characters\/new$/);
  // Nothing chosen yet → the rules list what's missing and Create is disabled.
  await page.getByTestId("creator-errors").getByText("Enter a name.").waitFor();
  assert.equal(await page.getByTestId("creator-create").isDisabled(), true);
  await page.getByTestId("creator-name").fill("Thalia Stonehearth");
  await page.getByTestId("creator-race-dwarf").click();
  await page.getByTestId("creator-class-cleric").click();
  // Point buy shows the budget live.
  await page.getByTestId("creator-method-pointbuy").click();
  await page.getByText("Points: 0/27").waitFor();
  await page.getByTestId("creator-base-wis").fill("15");
  await page.getByText("Points: 9/27").waitFor();
  // Back to the standard array: picking 15 for WIS swaps it with STR.
  await page.getByTestId("creator-method-standard").click();
  await page.getByTestId("creator-base-wis").selectOption("15");
  assert.equal(await page.getByTestId("creator-base-str").inputValue(), "10");
  assert.equal((await page.getByTestId("creator-final-wis").textContent()).trim().startsWith("16"), true, "Hill Dwarf +1 WIS");
  // Acolyte already gives Insight, so the cleric can't pick it again.
  assert.equal(await page.getByTestId("creator-skill-insight").isDisabled(), true);
  await page.getByTestId("creator-skill-medicine").click();
  await page.getByTestId("creator-skill-history").click();
  await page.getByTestId("creator-preview").waitFor();
  // d8 + CON 15 (+2) + Dwarven Toughness 1 = 11; AC 10 + DEX 14 (+2) = 12.
  assert.equal((await page.getByTestId("creator-hp").textContent()).trim(), "11");
  assert.equal((await page.getByTestId("creator-ac").textContent()).trim(), "12");
  await shot(page, "p3-04-creator");
  await page.getByTestId("creator-create").click();
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/);
  const cid = page.url().split("/").pop();
  const made = await page.evaluate(async (id) => (await (await fetch(`/api/characters/${id}`)).json()).character, cid);
  assert.equal(made.name, "Thalia Stonehearth");
  assert.equal(made.rulesetId, "dnd5e-2014");
  assert.deepEqual(made.data.abilities, { str: 10, dex: 14, con: 15, int: 12, wis: 16, cha: 8 });
  assert.deepEqual(made.data.hp, { max: 11, current: 11, temp: 0 });
  assert.deepEqual(Object.keys(made.data.skills).sort(), ["history", "insight", "medicine", "religion"]);
  assert.equal(made.data.classes[0].subclass, "Life Domain");
  assert.equal(made.data.spellcasting.slots[0].max, 2);
  await page.getByText("Thalia Stonehearth").first().waitFor();
  await shot(page, "p3-05-created-sheet");

  assert.deepEqual(errors, [], `Page errors: ${errors.join("; ")}`);
  console.log("PHASE 3 E2E OK");
  await browser.close();
})().catch((e) => {
  console.error("PHASE 3 E2E FAILED:", e);
  process.exit(1);
});
