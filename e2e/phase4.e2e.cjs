/**
 * Phase 4 browser walkthrough: HP tracking, initiative, turns, action economy, damage with
 * resistances, conditions that expire, defeated creatures. DM + player in two browser contexts.
 * Usage: BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase4.e2e.cjs
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
  }
  const find = async (page, name) => (await canvasTokens(page)).find((t) => t.texts.includes(name));
  const clickToken = async (page, name) => {
    const tk = await find(page, name);
    const p = await screenPoint(page, tk.x, tk.y);
    await page.mouse.click(p.x, p.y);
  };
  for (const p of [dm, pl]) p.on("dialog", (d) => d.accept());
  const combatant = (page, name) => page.getByTestId("combatant").filter({ hasText: name });

  // --- Setup through the API ---
  await dm.goto(`${BASE}/login`);
  await call(dm, "POST", "/api/auth/register", { email: `dm${uniq}@example.com`, username: `dm${uniq}`, password: "a-strong-password", displayName: "Mira" });
  const { campaign } = await call(dm, "POST", "/api/campaigns", { name: "Goblin Ambush", rulesetId: "dnd5e-2014" });
  const detail = await call(dm, "GET", `/api/campaigns/${campaign.id}`);
  await call(dm, "POST", `/api/campaigns/${campaign.id}/scenes`, { name: "Forest Road", width: 1400, height: 1000 });

  await pl.goto(`${BASE}/login`);
  await call(pl, "POST", "/api/auth/guest", { displayName: "Bram" });
  await call(pl, "POST", `/api/invitations/${detail.invitations[0].code}/accept`, {});
  const created = (await call(pl, "POST", "/api/characters", { name: "Bram Ironfoot", rulesetId: "dnd5e-2014" })).character;
  await call(pl, "PUT", `/api/characters/${created.id}`, { expectedVersion: created.version, data: { ...created.data, hp: { current: 12, max: 12, temp: 0 } } });
  await call(pl, "PUT", `/api/campaigns/${campaign.id}/character`, { characterId: created.id });

  // --- Both open the table; DM adds a Goblin with tracked HP and fire resistance ---
  await dm.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await dm.getByTestId("map-canvas").waitFor();
  await pl.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await pl.getByTestId("map-canvas").waitFor();
  await pl.getByTestId("place-my-token").click();
  await waitFor(() => find(dm, "Bram Ironfoot"), "DM sees Bram");

  await dm.getByTestId("add-token").click();
  const nameInput = dm.getByTestId("token-editor").getByRole("textbox", { name: "Name" });
  await nameInput.fill("Goblin");
  await nameInput.blur();
  await dm.getByTestId("max-hp").fill("7");
  await dm.getByTestId("max-hp-set").click();
  await dm.getByTestId("hp-value").filter({ hasText: "7 / 7" }).waitFor();
  await dm.getByTestId("token-resistances").fill("fire");
  await dm.getByTestId("token-ac").fill("15");
  await dm.getByTestId("token-ac").blur();
  await dm.getByText("AC 15").waitFor();
  await waitFor(() => find(pl, "Goblin"), "player sees Goblin");
  // Monsters' HP is DM-only by default; the PC's HP bar is visible to everyone.
  assert.equal((await find(pl, "Goblin")).hpBar, false, "player must not see the Goblin's HP bar");
  assert.equal((await find(pl, "Bram Ironfoot")).hpBar, true);
  assert.equal((await find(dm, "Goblin")).hpBar, true);

  // --- Start combat, roll initiative ---
  await dm.getByTestId("combat-start").click();
  await combatant(dm, "Goblin").waitFor();
  await combatant(pl, "Bram Ironfoot").waitFor(); // player panel appears live
  await combatant(pl, "Bram Ironfoot").getByTestId("roll-mine").click();
  await waitFor(async () => (await combatant(dm, "Bram Ironfoot").getByTestId("initiative-input").inputValue()) !== "", "player initiative rolled");
  await dm.getByTestId("roll-npcs").click();
  await waitFor(async () => (await combatant(pl, "Goblin").getByTestId("initiative").textContent()) !== "—", "player sees Goblin's initiative");
  // DM fixes the order: Goblin 20, Bram 10.
  for (const [name, v] of [["Goblin", "20"], ["Bram Ironfoot", "10"]]) {
    const input = combatant(dm, name).getByTestId("initiative-input");
    await input.fill(v);
    await input.press("Enter");
    await waitFor(async () => (await combatant(pl, name).getByTestId("initiative").textContent()) === v, `player sees ${name} at ${v}`);
  }
  const order = async (page) => (await page.getByTestId("combatant").allTextContents()).map((s) => (s.includes("Goblin") ? "Goblin" : "Bram"));
  assert.deepEqual(await order(pl), ["Goblin", "Bram"]);

  await dm.getByTestId("combat-next").click(); // Begin
  await waitFor(async () => (await find(pl, "Goblin"))?.active, "Goblin highlighted as active for the player");
  await shot(dm, "p4-01-dm-goblin-turn");
  await dm.getByTestId("combat-next").click();
  await pl.getByTestId("your-turn").waitFor();
  assert.ok((await find(dm, "Bram Ironfoot")).active);
  // Player tracks their action and ends their own turn.
  await pl.getByTestId("action-economy").getByRole("checkbox", { name: "Action", exact: true }).check();
  await waitFor(async () => dm.getByTestId("action-economy").getByRole("checkbox", { name: "Action", exact: true }).isChecked(), "DM sees action used");
  await shot(pl, "p4-02-player-turn");
  await pl.getByTestId("combat-next").click();
  await dm.getByTestId("combat-round").filter({ hasText: "Round 2" }).waitFor();
  await pl.getByTestId("combat-round").filter({ hasText: "Round 2" }).waitFor();

  // --- Damage with resistance ---
  await clickToken(dm, "Goblin");
  await dm.getByTestId("hp-amount").fill("5");
  await dm.getByRole("combobox", { name: "Damage type" }).selectOption("fire");
  await dm.getByTestId("hp-damage").click();
  await dm.getByTestId("hp-value").filter({ hasText: "5 / 7" }).waitFor(); // 5 fire halved to 2
  await dm.getByText("resistant to fire").waitFor();

  // --- Player damages and conditions their own token; DM sees it live ---
  await clickToken(pl, "Bram Ironfoot");
  await pl.getByTestId("hp-amount").fill("3");
  await pl.getByTestId("hp-damage").click();
  await combatant(dm, "Bram Ironfoot").getByText("9/12").waitFor();
  await pl.getByTestId("condition-select").selectOption("poisoned");
  await pl.getByRole("spinbutton", { name: "Rounds" }).fill("1");
  await pl.getByTestId("condition-add").click();
  await waitFor(async () => (await find(dm, "Bram Ironfoot"))?.conditions === "1", "DM sees condition badge");
  await combatant(dm, "Bram Ironfoot").getByText("poisoned · 1").waitFor();
  // The sheet itself was updated (HP lives on the character).
  const sheet = (await call(pl, "GET", `/api/characters/${created.id}`)).character;
  assert.deepEqual(sheet.data.hp, { current: 9, max: 12, temp: 0 });

  // Rolls straight from the token, with the sheet's numbers; DM sees them in the log.
  await pl.getByTestId("token-rolls").getByRole("button", { name: "Adv" }).click();
  await pl.getByTestId("roll-check-dex").click();
  await dm.getByText("Bram Ironfoot — Dexterity check").first().waitFor();
  await pl.getByTestId("token-rolls").getByRole("button", { name: "Saves" }).click();
  await pl.getByTestId("roll-save-con").click();
  await dm.getByText("Bram Ironfoot — Constitution save").first().waitFor();
  await pl.getByTestId("roll-skill").selectOption({ index: 1 });
  await pl.getByTestId("open-sheet").click();
  await pl.getByRole("dialog").waitFor();
  await shot(pl, "p4-05-player-sheet-from-token");
  await pl.keyboard.press("Escape");
  await pl.getByRole("dialog").getByRole("button", { name: "Close" }).click().catch(() => {});

  // Bram's turn ends → poisoned (1 round) expires.
  await dm.getByTestId("combat-next").click(); // Goblin → Bram
  await pl.getByTestId("your-turn").waitFor();
  await pl.getByTestId("combat-next").click(); // Bram ends turn
  await waitFor(async () => (await find(dm, "Bram Ironfoot"))?.conditions === null, "poisoned expired");

  // --- DM drops the Goblin: defeated and skipped ---
  await clickToken(dm, "Goblin");
  await dm.getByTestId("hp-amount").fill("10");
  await dm.getByRole("combobox", { name: "Damage type" }).selectOption("");
  await dm.getByTestId("hp-damage").click();
  await dm.getByTestId("hp-value").filter({ hasText: "0 / 7" }).waitFor();
  await waitFor(async () => (await find(dm, "Goblin"))?.texts.includes("✕"), "defeated mark on Goblin");
  await shot(dm, "p4-03-dm-goblin-down");
  await shot(pl, "p4-04-player-view");

  // --- Reload keeps combat state; DM ends combat ---
  await pl.reload();
  await combatant(pl, "Goblin").waitFor();
  await dm.getByTestId("combat-end").click(); // confirm handled below
  await pl.getByTestId("combat-panel").waitFor({ state: "detached" });

  assert.deepEqual(errors, [], `Page errors: ${errors.join("; ")}`);
  console.log("PHASE 4 E2E OK");
  await browser.close();
})().catch(async (e) => {
  console.error("PHASE 4 E2E FAILED:", e);
  process.exit(1);
});
