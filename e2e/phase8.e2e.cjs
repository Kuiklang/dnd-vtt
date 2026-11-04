/**
 * Phase 8 browser walkthrough: walls, doors and dynamic vision (the player loses sight of a
 * goblin behind a closed door, opens it, then needs light in a dark scene), the DM's
 * preview of a token's view, voice chat between two browsers (fake microphones), and the
 * DM's AI assistant (needs AI_PROVIDER=claude-code with Claude Code signed in, or skip
 * with AI_E2E=off).
 * Usage: BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase8.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS;
const uniq = Date.now().toString(36);

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

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

async function waitFor(fn, msg, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out: ${msg}`);
}

async function canvasTokens(page) {
  return page.evaluate(() => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return [];
    return stage.find(".token").map((g) => ({ x: Math.round(g.x()), y: Math.round(g.y()), texts: g.find("Text").map((t) => t.text()) }));
  });
}

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

const count = (page, sel) => page.evaluate((sel) => window.Konva?.stages?.[0]?.find(sel).length ?? 0, sel);

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const vp = { viewport: { width: 1440, height: 1000 }, permissions: ["microphone"] };
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
  const clickAt = async (page, x, y, opts) => {
    const p = await screenPoint(page, x, y);
    await page.mouse.click(p.x, p.y, opts);
  };

  // --- Setup ---
  await dm.goto(`${BASE}/login`);
  await call(dm, "POST", "/api/auth/register", { email: `dm8${uniq}@example.com`, username: `dm8${uniq}`, password: "a-strong-password", displayName: "Mira" });
  const { campaign } = await call(dm, "POST", "/api/campaigns", { name: "The Sunken Vault", rulesetId: "dnd5e-2014", setting: "A drowned dwarven city" });
  const detail = await call(dm, "GET", `/api/campaigns/${campaign.id}`);
  const scene = (await call(dm, "POST", `/api/campaigns/${campaign.id}/scenes`, { name: "Flooded Hall", width: 1400, height: 980, dmNotes: "A drowned priest guards the vault door." })).scene;
  await pl.goto(`${BASE}/login`);
  await call(pl, "POST", "/api/auth/guest", { displayName: "Ayla" });
  await call(pl, "POST", `/api/invitations/${detail.invitations[0].code}/accept`, {});
  const elara = (await call(pl, "POST", "/api/characters", { name: "Elara", rulesetId: "dnd5e-2014", data: { classes: [{ name: "Wizard", level: 3, hitDie: 6 }] } })).character;
  await call(pl, "PUT", `/api/campaigns/${campaign.id}/character`, { characterId: elara.id });

  await dm.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await dm.getByTestId("map-canvas").waitFor();
  await pl.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await pl.getByTestId("map-canvas").waitFor();
  await pl.getByTestId("place-my-token").click();
  const el = await waitFor(() => find(dm, "Elara"), "DM sees Elara");

  // A goblin three cells east of Elara.
  await dm.getByTestId("add-token").click();
  const nameInput = dm.getByTestId("token-editor").getByRole("textbox", { name: "Name" });
  await nameInput.fill("Goblin");
  await nameInput.blur();
  const g0 = await waitFor(() => find(dm, "Goblin"), "goblin placed");
  const from = await screenPoint(dm, g0.x, g0.y);
  const to = await screenPoint(dm, el.x + 210, el.y);
  await dm.mouse.move(from.x, from.y);
  await dm.mouse.down();
  await dm.mouse.move(to.x, to.y, { steps: 8 });
  await dm.mouse.up();
  // Tokens snap to cell centres, so wait for wherever it landed east of Elara.
  const g = await waitFor(async () => {
    const tk = await find(dm, "Goblin");
    return tk && tk.x > el.x + 150 && Math.abs(tk.y - el.y) < 40 ? tk : null;
  }, "goblin moved");
  await waitFor(() => find(pl, "Goblin"), "player sees the goblin before vision");

  // --- 1. Walls around the goblin, with a door facing Elara ---
  await dm.keyboard.press("Escape");
  await dm.getByTestId("tool-wall").click();
  const h = 35;
  for (const [x, y] of [[g.x - h, g.y - h], [g.x + h, g.y - h], [g.x + h, g.y + h], [g.x - h, g.y + h]]) await clickAt(dm, x, y);
  await dm.keyboard.press("Escape");
  await dm.getByTestId("wall-mode-door").click();
  await clickAt(dm, g.x - h, g.y + h);
  await clickAt(dm, g.x - h, g.y - h);
  await waitFor(async () => (await count(dm, ".wall")) === 4, "four walls drawn").catch(async (e) => { console.log("walls", await dm.evaluate(() => window.Konva.stages[0].find(".wall").map((w) => w.points()))); throw e; });
  await dm.getByTestId("tool-wall").click(); // back to select
  await dm.getByTestId("vision-enabled").check();
  await waitFor(async () => !(await find(pl, "Goblin")), "goblin hidden behind the closed door");
  await waitFor(async () => (await count(pl, ".darkness")) === 1, "player has a vision layer");
  assert.ok(await find(pl, "Elara"), "own token stays visible");
  await shot(dm, "p8-01-dm-walls");

  // --- 2. The player opens the door ---
  await waitFor(async () => (await count(pl, ".door")) === 1, "player sees the door icon");
  await clickAt(pl, g.x - h, g.y);
  await waitFor(() => find(pl, "Goblin"), "door opened: goblin visible");
  await shot(pl, "p8-02-door-open");

  // --- 3. Darkness: no light, no sight; a torch fixes it ---
  await dm.getByTestId("vision-ambient").selectOption("dark");
  await waitFor(async () => !(await find(pl, "Goblin")), "too dark to see the goblin");
  await clickAt(dm, el.x, el.y);
  await dm.getByTestId("token-light").selectOption("torch");
  await waitFor(() => find(pl, "Goblin"), "torchlight shows the goblin");
  await shot(pl, "p8-03-torchlight");
  // DM previews Elara's view.
  await dm.getByTestId("vision-preview").check();
  await waitFor(async () => (await count(dm, ".darkness")) === 1, "DM preview shows darkness");
  await shot(dm, "p8-04-dm-preview");
  await dm.getByTestId("vision-preview").uncheck();

  // --- 4. Voice chat between the two browsers ---
  await dm.getByTestId("voice-join").click();
  await pl.getByTestId("voice-join").click();
  await waitFor(async () => (await dm.locator('[data-testid="voice-peer"][data-state="connected"]').count()) === 1, "DM connected to the player", 20000);
  await waitFor(async () => (await pl.locator('[data-testid="voice-peer"][data-state="connected"]').count()) === 1, "player connected to the DM", 20000);
  await pl.getByTestId("voice-mute").click();
  await dm.getByTestId("voice-peer").getByText("🔇").waitFor();
  await shot(dm, "p8-05-voice");
  await pl.getByTestId("voice-leave").click();
  await waitFor(async () => (await dm.getByTestId("voice-peer").count()) === 0, "player left voice");

  // --- 5. The DM's AI assistant ---
  if (process.env.AI_E2E !== "off") {
    await dm.getByTestId("open-toolkit").click();
    await dm.getByTestId("toolkit-tab-ai").click();
    await dm.getByTestId("ai-mode-npc").click();
    await dm.getByTestId("ai-prompt").fill("the drowned priest");
    await dm.getByTestId("ai-ask").click();
    await dm.getByTestId("ai-answer").first().waitFor({ timeout: 180000 });
    const answer = await dm.getByTestId("ai-answer").first().innerText();
    assert.ok(answer.length > 80, "AI answered");
    await shot(dm, "p8-06-ai-npc");
    await dm.getByTestId("ai-save").first().click();
    await waitFor(async () => (await call(dm, "GET", `/api/campaigns/${campaign.id}/journal`)).entries.some((e) => e.folder === "AI"), "answer saved to the journal");
    const plAi = await call(pl, "GET", `/api/campaigns/${campaign.id}/ai`);
    assert.equal(plAi.available, false, "players can't use the assistant");
  }

  assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);
  void scene;
  console.log("Phase 8 E2E passed");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
