/**
 * Phase 7 browser walkthrough: a player adds Fireball from the SRD library and casts it from
 * the sheet (slot spent, rolls on the server, posted to the log), drops its 20-ft area on the
 * map (both browsers see it and the goblins inside light up), the DM aims a cone and removes it,
 * the player hands a potion to another character, and showing a scene starts its music.
 * Usage: BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase7.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS;
const uniq = Date.now().toString(36);

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** JSON API call from inside the page (uses the page's session cookie). */
async function call(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(j)}`);
      return j;
    },
    { method, url, body },
  );
}

async function waitFor(fn, msg, timeout = 8000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out: ${msg}`);
}




/** Token nodes currently drawn on the Konva stage (name + position in scene px). */
async function canvasTokens(page) {
  return page.evaluate(() => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return [];
    return stage.find(".token").map((g) => {
      const texts = g.find("Text").map((t) => t.text());
      return {
        x: Math.round(g.x()),
        y: Math.round(g.y()),
        texts,
        opacity: g.opacity(),
        hpBar: g.find(".hp-bar").length > 0,
        active: g.find(".active-turn").length > 0,
        conditions: g.find(".conditions").map((c) => c.findOne("Text").text())[0] ?? null,
      };
    });
  });
}

/** Screen coordinates of a scene point. */
async function screenPoint(page, x, y) {
  return page.evaluate(
    ({ x, y }) => {
      const stage = window.Konva.stages[0];
      const box = stage.container().getBoundingClientRect();
      const t = stage.getAbsoluteTransform().point({ x, y });
      return { x: box.left + t.x, y: box.top + t.y };
    },
    { x, y },
  );
}


const F = (n) => path.join(__dirname, "fixtures", n);

const stageCount = (page, sel) => page.evaluate((sel) => window.Konva?.stages?.[0]?.find(sel).length ?? 0, sel);

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1440, height: 1000 } };
  const dmCtx = await browser.newContext(vp);
  const plCtx = await browser.newContext({ ...vp, locale: "th-TH" });
  const dm = await dmCtx.newPage();
  const pl = await plCtx.newPage();
  const errors = [];
  for (const p of [dm, pl]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    p.on("dialog", (d) => d.accept());
  }
  const find = async (page, name) => (await canvasTokens(page)).find((t) => t.texts.includes(name));
  const clickToken = async (page, name) => {
    const tk = await find(page, name);
    const p = await screenPoint(page, tk.x, tk.y);
    await page.mouse.click(p.x, p.y);
  };

  // --- Setup through the API ---
  await dm.goto(`${BASE}/login`);
  await call(dm, "POST", "/api/auth/register", { email: `dm7${uniq}@example.com`, username: `dm7${uniq}`, password: "a-strong-password", displayName: "Mira" });
  const { campaign } = await call(dm, "POST", "/api/campaigns", { name: "Ashes of Kell", rulesetId: "dnd5e-2014" });
  const detail = await call(dm, "GET", `/api/campaigns/${campaign.id}`);
  await call(dm, "POST", `/api/campaigns/${campaign.id}/scenes`, { name: "Ruined Gate", width: 1400, height: 1000 });
  const inn = (await call(dm, "POST", `/api/campaigns/${campaign.id}/scenes`, { name: "Smoking Kettle Inn", width: 1000, height: 800 })).scene;
  // The DM plays a companion PC so the player has someone to hand items to.
  const torvin = (await call(dm, "POST", "/api/characters", { name: "Torvin", rulesetId: "dnd5e-2014" })).character;
  await call(dm, "PUT", `/api/campaigns/${campaign.id}/character`, { characterId: torvin.id });

  await pl.goto(`${BASE}/login`);
  await call(pl, "POST", "/api/auth/guest", { displayName: "Ayla" });
  await call(pl, "POST", `/api/invitations/${detail.invitations[0].code}/accept`, {});
  const elara = (
    await call(pl, "POST", "/api/characters", {
      name: "Elara",
      rulesetId: "dnd5e-2014",
      data: {
        classes: [{ name: "Wizard", level: 5, hitDie: 6 }],
        abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
        spellcasting: { ability: "int", slots: [{ max: 4, used: 0 }, { max: 3, used: 0 }, { max: 2, used: 0 }, ...Array.from({ length: 6 }, () => ({ max: 0, used: 0 }))], spells: [] },
        inventory: [{ id: "pot1", name: "Potion of Healing", category: "potion", quantity: 3, weight: 0.5, equipped: false, notes: "" }],
      },
    })
  ).character;
  await call(pl, "PUT", `/api/campaigns/${campaign.id}/character`, { characterId: elara.id });

  await dm.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await dm.getByTestId("map-canvas").waitFor();
  await pl.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await pl.getByTestId("map-canvas").waitFor();

  // Two goblins near the middle, and Elara's token.
  for (const name of ["Goblin A", "Goblin B"]) {
    await dm.getByTestId("add-token").click();
    const nameInput = dm.getByTestId("token-editor").getByRole("textbox", { name: "Name" });
    await nameInput.fill(name);
    await nameInput.blur();
    await waitFor(() => find(pl, name), `player sees ${name}`);
  }
  await pl.getByTestId("place-my-token").click();
  await waitFor(() => find(dm, "Elara"), "DM sees Elara");

  // --- 1. Add Fireball from the SRD library ---
  await clickToken(pl, "Elara");
  await pl.getByTestId("open-sheet").click();
  await pl.getByRole("tab", { name: "Spells" }).click();
  await pl.getByTestId("srd-spell-open").click();
  await pl.getByTestId("srd-spell-search").fill("fireball");
  await pl.getByTestId("srd-add-fireball").click();
  await pl.getByTestId("srd-spell-search").fill("fire bolt");
  await pl.getByTestId("srd-add-fire-bolt").click();
  await shot(pl, "p7-01-srd-library");
  await pl.keyboard.press("Escape");
  await pl.getByTestId("cast-Fireball").waitFor();
  // The sheet autosaves; wait until the server has both spells.
  await waitFor(async () => (await call(pl, "GET", `/api/characters/${elara.id}`)).character.data.spellcasting.spells.length === 2, "spells saved");

  // --- 2. Cast Fireball at 3rd level ---
  await pl.getByTestId("cast-Fireball").click();
  await pl.getByTestId("cast-slot").selectOption("3");
  await shot(pl, "p7-02-cast-dialog");
  await pl.getByTestId("cast-confirm").click();
  const last = pl.getByTestId("last-cast");
  await last.waitFor();
  await last.getByText("3rd-level slot used").waitFor();
  await last.getByText("DC 15 DEX save").waitFor();
  await last.getByText("Fireball — fire damage").waitFor();
  const sheet = (await call(pl, "GET", `/api/characters/${elara.id}`)).character;
  assert.equal(sheet.data.spellcasting.slots[2].used, 1, "3rd-level slot spent on the server");
  // Everyone sees the cast and the damage roll in the log.
  await dm.getByText(/Elara casts Fireball at 3rd level — DC 15 Dex save \(half on success\) — 20-ft sphere/).first().waitFor();
  await dm.getByText("Fireball — fire damage").first().waitFor();
  await shot(pl, "p7-03-cast-result");

  // --- 3. Drop the area on the goblins ---
  await pl.getByTestId("place-template").click();
  await waitFor(async () => (await pl.getByTestId("tool-template").getAttribute("aria-pressed")) === "true", "template tool active");
  const ga = await find(pl, "Goblin A");
  const gb = await find(pl, "Goblin B");
  const mid = await screenPoint(pl, (ga.x + gb.x) / 2, (ga.y + gb.y) / 2);
  await pl.mouse.move(mid.x, mid.y);
  await pl.mouse.down();
  await pl.mouse.move(mid.x + 30, mid.y + 10, { steps: 3 });
  await pl.mouse.up();
  await waitFor(async () => (await stageCount(dm, ".template")) === 1, "DM sees the Fireball template");
  await waitFor(async () => (await stageCount(dm, ".aoe-hit")) >= 2, "both goblins highlighted for the DM");
  assert.ok((await stageCount(pl, ".aoe-hit")) >= 2, "goblins highlighted for the player");
  const tpl = await dm.evaluate(() => window.Konva.stages[0].findOne(".template").findOne("Text")?.text());
  assert.equal(tpl, "Fireball");
  await shot(dm, "p7-04-dm-fireball-template");
  await shot(pl, "p7-05-player-fireball-template");

  // --- 4. DM aims a 15-ft cone, then removes it ---
  await dm.getByTestId("tool-template").click();
  await dm.getByTestId("template-shape-cone").click();
  await dm.getByTestId("template-size").fill("15");
  const el = await find(dm, "Elara");
  const o = await screenPoint(dm, el.x + 140, el.y + 140);
  await dm.mouse.move(o.x, o.y);
  await dm.mouse.down();
  await dm.mouse.move(o.x + 80, o.y, { steps: 4 });
  await shot(dm, "p7-06-dm-aiming-cone");
  await dm.mouse.up();
  await waitFor(async () => (await stageCount(pl, ".template")) === 2, "player sees the cone");
  await dm.getByTestId("template-delete").click();
  await waitFor(async () => (await stageCount(pl, ".template")) === 1, "cone removed for the player");

  // --- 5. Give a potion to Torvin ---
  await clickToken(pl, "Elara");
  await pl.getByTestId("open-sheet").click();
  await pl.getByRole("tab", { name: "Inventory" }).click();
  await pl.getByTestId("give-Potion of Healing").click();
  await pl.getByTestId("give-to").selectOption({ label: "Torvin" });
  await pl.getByTestId("give-qty").fill("1");
  await shot(pl, "p7-07-give-item");
  await pl.getByTestId("give-confirm").click();
  await dm.getByText(/Elara gave Potion of Healing to Torvin/).first().waitFor();
  const t2 = (await call(dm, "GET", `/api/characters/${torvin.id}`)).character;
  assert.deepEqual(t2.data.inventory.map((i) => [i.name, i.quantity]), [["Potion of Healing", 1]]);
  const e2 = (await call(pl, "GET", `/api/characters/${elara.id}`)).character;
  assert.equal(e2.data.inventory[0].quantity, 2);
  await pl.keyboard.press("Escape");

  // --- 6. Scene music: the inn plays its tune when shown ---
  await dm.getByTestId("open-music").click();
  await dm.getByTestId("music-tab-library").click();
  await dm.getByTestId("audio-file").setInputFiles(F("tavern-tune.wav"));
  await dm.getByTestId("track-tavern tune").waitFor();
  await dm.keyboard.press("Escape");
  const lib = await call(dm, "GET", `/api/campaigns/${campaign.id}/audio`);
  const tune = lib.tracks.find((x) => x.name === "tavern tune");
  await dm.getByTestId("scene-list").getByRole("button", { name: "Smoking Kettle Inn" }).click();
  await waitFor(async () => (await dm.getByTestId("scene-music").count()) > 0 && (await dm.getByTestId("scene-music").locator("option").count()) > 1, "scene music options");
  await dm.getByTestId("scene-music").selectOption(`track:${tune.id}`);
  await dm.getByRole("button", { name: "Save", exact: true }).click();
  await waitFor(async () => (await call(dm, "GET", `/api/campaigns/${campaign.id}/scenes`)).scenes.find((s) => s.id === inn.id).music?.id === tune.id, "scene music saved");
  await shot(dm, "p7-08-scene-music");
  const b = pl.getByTestId("audio-unblock");
  if (await b.count()) await b.click();
  await dm.getByTestId("scene-list").locator("li", { hasText: "Smoking Kettle Inn" }).getByRole("button", { name: /Show to players|Activate/ }).click();
  await waitFor(async () => {
    const a = await pl.evaluate(() => {
      const el = document.querySelector('[data-testid="audio-music"]');
      return el ? { track: el.dataset.track, paused: el.paused } : null;
    });
    return a && a.track === tune.id && !a.paused;
  }, "player hears the inn's music", 12000);
  await pl.getByText("Smoking Kettle Inn").first().waitFor();
  await shot(pl, "p7-09-player-inn-music");

  assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);
  console.log("Phase 7 E2E passed");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
