/**
 * Phase 5 browser walkthrough: DM toolkit. Bestiary (place SRD monsters, copy to campaign),
 * encounter builder (deploy hidden + start combat), stat-block rolls from a token, journal with
 * per-viewer visibility, handouts pushed to a player, random tables, DM screen.
 * Usage: BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase5.e2e.cjs
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



const PNG = require("node:fs").readFileSync(path.join(__dirname, "fixtures", "letter.png"));

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
  const names = async (page) => (await canvasTokens(page)).flatMap((t) => t.texts);
  const find = async (page, name) => (await canvasTokens(page)).find((t) => t.texts.includes(name));
  const clickToken = async (page, name) => {
    const tk = await find(page, name);
    const p = await screenPoint(page, tk.x, tk.y);
    await page.mouse.click(p.x, p.y);
  };
  const tab = (id) => dm.getByTestId(`toolkit-tab-${id}`).click();
  const closeDialog = async (page) => {
    await page.keyboard.press("Escape");
    await waitFor(async () => (await page.getByRole("dialog").count()) === 0, "dialog closes");
  };

  // --- Setup through the API ---
  await dm.goto(`${BASE}/login`);
  await call(dm, "POST", "/api/auth/register", { email: `dm5${uniq}@example.com`, username: `dm5${uniq}`, password: "a-strong-password", displayName: "Mira" });
  const { campaign } = await call(dm, "POST", "/api/campaigns", { name: "Road to Brindle", rulesetId: "dnd5e-2014" });
  const detail = await call(dm, "GET", `/api/campaigns/${campaign.id}`);
  await call(dm, "POST", `/api/campaigns/${campaign.id}/scenes`, { name: "Forest Road", width: 1400, height: 1000 });
  await pl.goto(`${BASE}/login`);
  const guest = await call(pl, "POST", "/api/auth/guest", { displayName: "Bram" });
  await call(pl, "POST", `/api/invitations/${detail.invitations[0].code}/accept`, {});

  await dm.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await dm.getByTestId("map-canvas").waitFor();
  await pl.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await pl.getByTestId("map-canvas").waitFor();
  // Players get the journal but not the DM toolkit.
  assert.equal(await pl.getByTestId("open-toolkit").count(), 0);

  // --- 1. Bestiary: place three goblins with rolled HP ---
  await dm.getByTestId("open-toolkit").click();
  await dm.getByTestId("bestiary").waitFor();
  await dm.getByTestId("bestiary-search").fill("gob");
  await dm.getByTestId("bestiary-goblin").click();
  await dm.getByTestId("stat-block").getByText("Nimble Escape").waitFor();
  await dm.getByTestId("bestiary-count").fill("3");
  await dm.getByTestId("bestiary-hp").selectOption("roll");
  await shot(dm, "p5-01-bestiary");
  await dm.getByTestId("bestiary-place").click();
  await waitFor(async () => ["Goblin 1", "Goblin 2", "Goblin 3"].every((n) => names(dm).then((l) => l.includes(n))) && (await names(dm)).includes("Goblin 3"), "DM sees 3 goblins");
  await waitFor(async () => (await names(pl)).includes("Goblin 3"), "player sees goblins");
  assert.equal((await find(pl, "Goblin 1")).hpBar, false, "monster HP stays DM-only");

  // --- 2. Copy a stat block into the campaign to edit it ---
  await dm.getByTestId("bestiary-search").fill("captain");
  await dm.getByTestId("bestiary-bandit-captain").click();
  await dm.getByTestId("bestiary-copy").click();
  await dm.getByTestId("bestiary-own-Bandit Captain").waitFor();
  await dm.getByTestId("bestiary-edit-own").waitFor();

  // --- 3. Encounter: 2 wolves + the campaign's Bandit Captain, placed hidden, combat starts ---
  await tab("encounters");
  await dm.getByTestId("encounter-name").fill("Road ambush");
  await dm.getByTestId("encounter-pick").selectOption("srd:wolf");
  await dm.getByTestId("encounter-add").click();
  await dm.getByTestId("encounter-count-0").fill("2");
  await dm.getByTestId("encounter-pick").selectOption({ label: "Bandit Captain" });
  await dm.getByTestId("encounter-add").click();
  await dm.getByTestId("encounter-xp").getByText("Total 100 XP").waitFor();
  await dm.getByTestId("encounter-save").click();
  await dm.getByTestId("encounters").locator("button", { hasText: "Road ambush" }).waitFor();
  await shot(dm, "p5-02-encounter");
  await dm.getByTestId("encounter-fight").click();
  await waitFor(async () => (await names(dm)).includes("Bandit Captain"), "encounter placed");
  await dm.getByTestId("combatant").filter({ hasText: "Wolf 2" }).waitFor();
  await dm.getByTestId("combatant").filter({ hasText: "Bandit Captain" }).waitFor();
  await new Promise((r) => setTimeout(r, 400));
  const plNames = await names(pl);
  assert.equal(plNames.includes("Wolf 1") || plNames.includes("Bandit Captain"), false, "hidden encounter tokens stay hidden from players");
  await closeDialog(dm);

  // --- 4. Stat block on a token: DM-only attack roll ---
  await clickToken(dm, "Goblin 1");
  await dm.getByTestId("token-stat-block").waitFor();
  await dm.getByTestId("token-stat-block").getByTestId("sb-attack-Scimitar").click();
  await dm.locator("span", { hasText: "Goblin 1 — Scimitar attack" }).first().waitFor();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await pl.getByText("Scimitar attack").count(), 0, "DM-only stat block roll must not reach the player");

  // --- 5. Journal + handout ---
  await dm.getByTestId("open-journal").click();
  await dm.getByTestId("journal-new").click();
  await dm.getByTestId("journal-title").fill("Sealed letter");
  await dm.getByTestId("journal-body").fill("**Meet** me at the old mill at midnight.\n\n- come alone");
  await dm.getByTestId("journal-image-file").setInputFiles({ name: "letter.png", mimeType: "image/png", buffer: PNG });
  await dm.getByTestId("journal-editor").locator("img").waitFor();
  await dm.getByTestId("journal-save").click();
  await dm.getByTestId("journal-view").getByText("Meet").waitFor();
  assert.equal(await dm.getByTestId("journal-view").locator("strong").textContent(), "Meet", "Markdown renders bold");

  await pl.getByTestId("open-journal").click();
  await pl.getByTestId("journal").waitFor();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await pl.getByTestId("journal-item-Sealed letter").count(), 0, "DM-only entry hidden from player");
  // Player writes a personal note; the DM can't see it.
  await pl.getByTestId("journal-new").click();
  await pl.getByTestId("journal-title").fill("My suspicions");
  await pl.getByTestId("journal-body").fill("The miller is lying.");
  await pl.getByTestId("journal-save").click();
  await pl.getByTestId("journal-item-My suspicions").waitFor();
  await closeDialog(pl);

  await dm.getByTestId("journal-show-to").selectOption({ label: "Bram" });
  await dm.getByTestId("journal-show").click();
  await pl.getByTestId("handout-popup").waitFor();
  await pl.getByTestId("handout-popup").getByText("Meet").waitFor();
  await waitFor(() => pl.getByTestId("handout-image").evaluate((img) => img.complete && img.naturalWidth > 0), "handout image loads for the player");
  await shot(pl, "p5-03-handout");
  assert.equal(await dm.getByTestId("journal-item-My suspicions").count(), 0, "personal note stays private");
  await closeDialog(pl);
  await pl.getByTestId("open-journal").click();
  await pl.getByTestId("journal-item-Sealed letter").waitFor();
  await closeDialog(pl);

  // --- 6. Random table, rolled DM-only ---
  await closeDialog(dm);
  await dm.getByTestId("open-toolkit").click();
  await tab("tables");
  await dm.getByTestId("table-new").click();
  await dm.getByTestId("table-name").fill("Weather");
  await dm.getByTestId("table-formula").fill("1d4");
  await dm.getByTestId("table-entries").fill("1-2 Clear skies\n3 Light rain\n4 Thunderstorm");
  await dm.getByTestId("table-save").click();
  await dm.getByTestId("table-roll-Weather").click();
  const result = await dm.getByTestId("table-results").locator("li").first().locator("div").textContent();
  assert.ok(["Clear skies", "Light rain", "Thunderstorm"].includes(result), `table result: ${result}`);
  await dm.locator("span", { hasText: `Weather: ${result}` }).first().waitFor();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await pl.getByText(`Weather: ${result}`).count(), 0, "DM-only table roll hidden from player");
  await shot(dm, "p5-04-tables");

  // --- 7. DM screen ---
  await tab("screen");
  await dm.getByTestId("dm-screen").getByText("Nearly impossible").waitFor();
  await dm.getByTestId("dm-screen").getByText("Grappled.").waitFor();
  await shot(dm, "p5-05-dm-screen");

  assert.deepEqual(errors, [], `Page errors: ${errors.join("; ")}`);
  console.log("PHASE 5 E2E OK");
  await browser.close();
})().catch((e) => {
  console.error("PHASE 5 E2E FAILED:", e);
  process.exit(1);
});
