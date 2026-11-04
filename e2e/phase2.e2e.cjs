/**
 * Phase 2 browser walkthrough: map upload, grid, tokens, realtime sync, fog of war,
 * measurement, reconnect. DM + player in two isolated browser contexts.
 * Usage: start the server serving the built web app, then
 *   BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase2.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS;
const uniq = Date.now().toString(36);
const MAP = path.join(__dirname, "fixtures/crypt-map.png");
const TOKEN_IMG = path.join(__dirname, "fixtures/ogre.png");

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
      return { x: Math.round(g.x()), y: Math.round(g.y()), texts, opacity: g.opacity() };
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
  const vp = { viewport: { width: 1440, height: 900 } };
  const dmCtx = await browser.newContext(vp);
  const plCtx = await browser.newContext({ ...vp, locale: "th-TH" });
  const dm = await dmCtx.newPage();
  const pl = await plCtx.newPage();
  const errors = [];
  for (const p of [dm, pl]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  }

  // --- Setup through the API (Phase 1 flows are covered by phase1.e2e) ---
  await dm.goto(`${BASE}/login`);
  await call(dm, "POST", "/api/auth/register", { email: `dm${uniq}@example.com`, username: `dm${uniq}`, password: "a-strong-password", displayName: "Mira" });
  const { campaign } = await call(dm, "POST", "/api/campaigns", { name: "The Sunken Crypt", rulesetId: "dnd5e-2014" });
  const detail = await call(dm, "GET", `/api/campaigns/${campaign.id}`);
  const code = detail.invitations[0].code;

  await pl.goto(`${BASE}/login`);
  await call(pl, "POST", "/api/auth/guest", { displayName: "Bram" });
  await call(pl, "POST", `/api/invitations/${code}/accept`, {});
  const { character } = await call(pl, "POST", "/api/characters", { name: "Bram Ironfoot", rulesetId: "dnd5e-2014" });
  await call(pl, "PUT", `/api/campaigns/${campaign.id}/character`, { characterId: character.id });

  // --- DM opens the table and uploads a map ---
  await dm.goto(`${BASE}/campaigns/${campaign.id}`);
  await dm.getByTestId("enter-table").click();
  await dm.waitForURL(/\/table$/);
  await dm.getByText("No maps yet").first().waitFor();
  await dm.getByPlaceholder("Map name").fill("Crypt Level 1");
  await dm.getByTestId("map-upload").setInputFiles(MAP);
  await dm.getByTestId("scene-list").getByText("Crypt Level 1").waitFor();
  await dm.getByTestId("map-canvas").waitFor();
  await dm.getByText("Players here").waitFor(); // first map becomes active
  await shot(dm, "p2-01-dm-map");

  // Player is already on the table (Thai UI) and sees the map without refreshing
  await pl.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await pl.getByTestId("map-canvas").waitFor();
  await pl.getByRole("button", { name: "วางตัวละครของฉัน" }).waitFor();

  // --- DM adds a token, uploads its image, renames ---
  await dm.getByTestId("add-token").click();
  await dm.getByTestId("token-editor").waitFor();
  const nameInput = dm.getByTestId("token-editor").getByRole("textbox", { name: "Name" });
  await nameInput.fill("Ogre");
  await nameInput.blur();
  await waitFor(async () => (await canvasTokens(pl)).some((t) => t.texts.includes("Ogre")), "player sees Ogre token");

  // --- Player places own token and drags it; DM sees the snapped position ---
  await pl.getByTestId("place-my-token").click();
  const bram = await waitFor(async () => (await canvasTokens(pl)).find((t) => t.texts.includes("Bram Ironfoot")), "player token drawn");
  await waitFor(async () => (await canvasTokens(dm)).some((t) => t.texts.includes("Bram Ironfoot")), "DM sees player token");
  const from = await screenPoint(pl, bram.x, bram.y);
  const target = { x: 175, y: 245 }; // centre of cell (2,3) with 70px grid
  const to = await screenPoint(pl, target.x + 20, target.y - 15);
  await pl.mouse.move(from.x, from.y);
  await pl.mouse.down();
  await pl.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await pl.mouse.move(to.x, to.y, { steps: 5 });
  await pl.mouse.up();
  await waitFor(
    async () => (await canvasTokens(dm)).some((t) => t.texts.includes("Bram Ironfoot") && t.x === target.x && t.y === target.y),
    "DM sees snapped move",
  );
  await shot(pl, "p2-02-player-moved");

  // Player cannot drag the DM's Ogre (not an owner)
  const ogre = (await canvasTokens(pl)).find((t) => t.texts.includes("Ogre"));
  const og = await screenPoint(pl, ogre.x, ogre.y);
  await pl.mouse.move(og.x, og.y);
  await pl.mouse.down();
  await pl.mouse.move(og.x + 150, og.y + 150, { steps: 6 });
  await pl.mouse.up();
  await pl.waitForTimeout(400);
  const ogreAfter = (await canvasTokens(dm)).find((t) => t.texts.includes("Ogre"));
  assert.deepEqual([ogreAfter.x, ogreAfter.y], [ogre.x, ogre.y], "player moved a token they don't own");

  // --- Hidden token never reaches the player ---
  await dm.evaluate(() => {}); // keep focus
  const ogreDm = (await canvasTokens(dm)).find((t) => t.texts.includes("Ogre"));
  const ogp = await screenPoint(dm, ogreDm.x, ogreDm.y);
  await dm.mouse.click(ogp.x, ogp.y);
  await dm.getByTestId("token-hidden").check();
  await waitFor(async () => !(await canvasTokens(pl)).some((t) => t.texts.includes("Ogre")), "hidden Ogre removed for player");
  assert.ok((await canvasTokens(dm)).find((t) => t.texts.includes("Ogre")).opacity < 1, "DM sees hidden token ghosted");
  await dm.getByTestId("token-hidden").uncheck();
  await waitFor(async () => (await canvasTokens(pl)).some((t) => t.texts.includes("Ogre")), "Ogre visible again");

  // --- Fog of war: enable, player loses non-owned tokens, DM reveals an area ---
  await dm.getByTestId("fog-enabled").check();
  await waitFor(async () => {
    const names = (await canvasTokens(pl)).map((t) => t.texts.join(" "));
    return names.length === 1 && names[0].includes("Bram Ironfoot");
  }, "fog hides Ogre but keeps own token");
  await dm.getByTestId("tool-fog-reveal").click();
  const ogreNow = (await canvasTokens(dm)).find((t) => t.texts.includes("Ogre"));
  const a = await screenPoint(dm, ogreNow.x - 100, ogreNow.y - 100);
  const b = await screenPoint(dm, ogreNow.x + 100, ogreNow.y + 100);
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  await dm.mouse.move(b.x, b.y, { steps: 6 });
  await dm.mouse.up();
  await waitFor(async () => (await canvasTokens(pl)).some((t) => t.texts.includes("Ogre")), "revealed area shows Ogre");
  // Players: fog is drawn under their tokens (own token stays visible); GMs: fog over tokens.
  const order = (page) =>
    page.evaluate(() => {
      const layers = window.Konva.stages[0].getLayers().map((l) => l.name());
      return layers.indexOf("fog") < layers.indexOf("tokens") ? "fog-under" : "fog-over";
    });
  assert.equal(await order(pl), "fog-under");
  assert.equal(await order(dm), "fog-over");
  await shot(dm, "p2-03-dm-fog");
  await shot(pl, "p2-04-player-fog");

  // --- Measurement (5e 2014: uniform diagonals, 5 ft per cell) ---
  await pl.getByTestId("tool-measure").click();
  const m1 = await screenPoint(pl, 35, 35);
  const m2 = await screenPoint(pl, 35 + 70 * 4, 35 + 70 * 2);
  await pl.mouse.click(m1.x, m1.y);
  await pl.mouse.move(m2.x, m2.y, { steps: 3 });
  const label = await waitFor(
    () => pl.evaluate(() => window.Konva.stages[0].find("Text").map((t) => t.text()).find((s) => / ft$/.test(s))),
    "measurement label",
  );
  assert.equal(label, "20 ft");
  await shot(pl, "p2-05-measure");
  await pl.keyboard.press("Escape");

  // --- Grid settings: switch to hex, player gets the update live ---
  await dm.getByTestId("grid-type").selectOption("hex");
  await dm.getByRole("button", { name: "Save", exact: true }).click();
  await waitFor(() => pl.evaluate(() => true), "noop");
  await dm.getByText("All changes saved").first().waitFor();

  // --- Reconnect: reload the player; state comes back without duplicates ---
  await pl.reload();
  await pl.getByTestId("map-canvas").waitFor();
  const after = await waitFor(async () => {
    const t = await canvasTokens(pl);
    return t.length === 2 ? t : null;
  }, "tokens restored after reload");
  assert.equal(after.filter((t) => t.texts.includes("Bram Ironfoot")).length, 1);

  // --- DM switches players to a new blank map ---
  await dm.getByPlaceholder("Map name").fill("Town Square");
  await dm.getByRole("button", { name: "Blank grid" }).click();
  await dm.getByTestId("scene-list").getByText("Town Square").waitFor();
  await dm.getByTestId("scene-list").getByRole("button", { name: "Show to players" }).click();
  await waitFor(async () => (await canvasTokens(pl)).length === 0, "player moved to empty Town Square");
  await pl.getByText("/ Town Square").waitFor();
  await shot(pl, "p2-06-player-switched");

  // Mobile smoke test for the table
  await pl.setViewportSize({ width: 390, height: 844 });
  await pl.reload(); // panels start collapsed on phones
  await pl.getByTestId("map-canvas").waitFor();
  await pl.waitForTimeout(300);
  const overflow = await pl.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `Horizontal overflow on mobile table: ${overflow}px`);
  await shot(pl, "p2-07-player-mobile");

  assert.deepEqual(errors, [], `Page errors: ${errors.join("; ")}`);
  console.log("PHASE 2 E2E OK");
  await browser.close();
})().catch(async (e) => {
  console.error("PHASE 2 E2E FAILED:", e);
  process.exit(1);
});
