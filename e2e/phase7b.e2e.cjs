/**
 * Phase 7 (round 2) browser walkthrough: concentration from a cast (badge, Con save DC on damage,
 * end), dragging an area template, undo/redo of map edits, and the campaign timeline with a
 * recap drafted from the session log and published to players, plus a DM-only story event.
 * Usage: BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase7b.e2e.cjs
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
  const templatePos = (page) =>
    page.evaluate(() => {
      const g = window.Konva.stages[0].findOne(".template");
      return g ? g.findOne("Line").points().slice(0, 2) : null;
    });

  // --- Setup through the API ---
  await dm.goto(`${BASE}/login`);
  await call(dm, "POST", "/api/auth/register", { email: `dm7b${uniq}@example.com`, username: `dm7b${uniq}`, password: "a-strong-password", displayName: "Mira" });
  const { campaign } = await call(dm, "POST", "/api/campaigns", { name: "Embers of Vael", rulesetId: "dnd5e-2014" });
  const detail = await call(dm, "GET", `/api/campaigns/${campaign.id}`);
  await call(dm, "POST", `/api/campaigns/${campaign.id}/scenes`, { name: "Burning Mill", width: 1400, height: 1000 });
  await pl.goto(`${BASE}/login`);
  await call(pl, "POST", "/api/auth/guest", { displayName: "Ayla" });
  await call(pl, "POST", `/api/invitations/${detail.invitations[0].code}/accept`, {});
  const spell = (id, name, level, concentration) => ({ id: `s-${id}`, name, level, school: "", prepared: true, concentration, ritual: false, notes: "", srdId: id });
  const elara = (
    await call(pl, "POST", "/api/characters", {
      name: "Elara",
      rulesetId: "dnd5e-2014",
      data: {
        classes: [{ name: "Wizard", level: 5, hitDie: 6 }],
        abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
        hp: { max: 40, current: 40, temp: 0 },
        spellcasting: { ability: "int", slots: [{ max: 4, used: 0 }, { max: 3, used: 0 }, { max: 2, used: 0 }, ...Array.from({ length: 6 }, () => ({ max: 0, used: 0 }))], spells: [spell("bless", "Bless", 1, true), spell("fire-bolt", "Fire Bolt", 0, false)] },
      },
    })
  ).character;
  await call(pl, "PUT", `/api/campaigns/${campaign.id}/character`, { characterId: elara.id });
  const session = (await call(dm, "POST", `/api/campaigns/${campaign.id}/session/start`, { name: "The Burning Mill" })).session;

  await dm.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await dm.getByTestId("map-canvas").waitFor();
  await pl.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await pl.getByTestId("map-canvas").waitFor();
  await pl.getByTestId("place-my-token").click();
  await waitFor(() => find(dm, "Elara"), "DM sees Elara");

  // --- 1. Cast Bless: concentration starts ---
  await clickToken(pl, "Elara");
  await pl.getByTestId("open-sheet").click();
  await pl.getByRole("tab", { name: "Spells" }).click();
  await pl.getByTestId("cast-Bless").click();
  await pl.getByTestId("cast-confirm").click();
  await pl.getByTestId("concentration").filter({ hasText: "Bless" }).first().waitFor();
  await pl.getByTestId("cast-Fire Bolt").click(); // a cantrip without concentration leaves it alone
  await pl.getByTestId("last-cast").getByText("Fire Bolt (cantrip)").waitFor();
  await pl.getByTestId("concentration").filter({ hasText: "Bless" }).first().waitFor();
  await shot(pl, "p7b-01-concentrating-sheet");
  await pl.keyboard.press("Escape");
  await pl.getByTestId("token-rolls").getByTestId("concentration").waitFor();

  // --- 2. DM hits her for 24: the log asks for a DC 12 Con save ---
  await clickToken(dm, "Elara");
  await dm.getByTestId("hp-amount").fill("24");
  await dm.getByTestId("hp-damage").click();
  await pl.getByText("Elara must make a DC 12 Constitution save to keep concentrating on Bless").first().waitFor();
  await pl.getByTestId("token-rolls").getByTestId("concentration-save").click();
  await dm.getByText(/Concentration \(Con save\) — Bless/).first().waitFor();
  await shot(pl, "p7b-02-con-save");
  await pl.getByTestId("token-rolls").getByTestId("concentration-end").click();
  await dm.getByText("Elara stops concentrating on Bless").first().waitFor();
  await waitFor(async () => (await pl.getByTestId("concentration").count()) === 0, "badge gone");
  assert.equal((await call(pl, "GET", `/api/characters/${elara.id}`)).character.data.concentration, null);

  // --- 3. Drag an area template ---
  await pl.getByTestId("tool-template").click();
  const el = await find(pl, "Elara");
  const o = await screenPoint(pl, el.x + 280, el.y);
  await pl.mouse.move(o.x, o.y);
  await pl.mouse.down();
  await pl.mouse.up();
  await waitFor(async () => (await dm.evaluate(() => window.Konva.stages[0].find(".template").length)) === 1, "DM sees the template");
  const before = await templatePos(dm);
  // Back in the select tool, drag it 3 cells down.
  const inside = await screenPoint(pl, el.x + 280, el.y + 60);
  await pl.mouse.move(inside.x, inside.y);
  await pl.mouse.down();
  await pl.mouse.move(inside.x, inside.y + 100, { steps: 6 });
  await pl.mouse.up();
  await waitFor(async () => {
    const p = await templatePos(dm);
    const mine = await templatePos(pl);
    return p && p[1] > before[1] + 50 && Math.abs(p[1] - mine[1]) < 1;
  }, "DM sees the template moved");
  await shot(dm, "p7b-03-template-dragged");

  // --- 4. Undo / redo (DM) ---
  await dm.keyboard.press("Escape");
  await dm.getByTestId("add-token").click();
  const nameInput = dm.getByTestId("token-editor").getByRole("textbox", { name: "Name" });
  await nameInput.fill("Cultist");
  await nameInput.blur();
  await waitFor(() => find(pl, "Cultist"), "player sees Cultist");
  await dm.getByTestId("undo").click(); // rename undone
  await waitFor(async () => !(await find(pl, "Cultist")) && (await find(pl, "Token")), "rename undone for the player");
  await dm.getByTestId("undo").click(); // token removed
  await waitFor(async () => !(await find(pl, "Token")), "token removed for the player");
  await dm.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await dm.keyboard.press("Control+Shift+Z"); // back again
  await waitFor(() => find(pl, "Token"), "token restored for the player");
  await dm.getByTestId("redo").click(); // and renamed
  await waitFor(() => find(pl, "Cultist"), "rename redone for the player");
  await shot(dm, "p7b-04-undo-redo");

  // --- 5. Timeline: recap drafted from the log, published; secret event stays secret ---
  await call(dm, "POST", `/api/campaigns/${campaign.id}/session/end`, {});
  await dm.getByTestId("open-timeline").click();
  const editor = dm.getByTestId("recap-editor-1");
  await editor.waitFor();
  await editor.getByTestId("recap-draft").click();
  await waitFor(async () => (await editor.getByTestId("recap-input").inputValue()).includes("Elara casts Bless"), "recap draft from the log");
  const draft = await editor.getByTestId("recap-input").inputValue();
  assert.match(draft, /^Session 1: The Burning Mill/);
  assert.match(draft, /Elara must make a DC 12 Constitution save/);
  await editor.getByTestId("recap-input").fill(draft.replace("Notes:\n- ", "Notes:\n- The mill burned down, but the miller lived."));
  await editor.getByTestId("recap-publish").click();
  const form = dm.getByTestId("timeline-event-form");
  await form.getByTestId("event-title").fill("The mill burns");
  await form.getByTestId("event-date").fill("Day 3 of Frostfall");
  await form.getByTestId("event-session").selectOption({ index: 1 });
  await form.getByTestId("event-save").click();
  await form.getByTestId("event-title").fill("The baron hired the cult");
  await form.getByTestId("event-visibility").selectOption("dm");
  await form.getByTestId("event-save").click();
  await dm.getByTestId("timeline-event").filter({ hasText: "The baron hired the cult" }).waitFor();
  await shot(dm, "p7b-05-dm-timeline");

  await pl.getByTestId("open-timeline").click();
  await pl.getByTestId("recap-text").filter({ hasText: "the miller lived" }).waitFor();
  await pl.getByTestId("timeline-event").filter({ hasText: "The mill burns" }).waitFor();
  assert.equal(await pl.getByText("The baron hired the cult").count(), 0, "secret event hidden from the player");
  await shot(pl, "p7b-06-player-timeline");
  void session;

  assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);
  console.log("Phase 7b E2E passed");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
