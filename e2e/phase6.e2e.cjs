/**
 * Phase 6 browser walkthrough: music & ambience. DM uploads music/ambient/effects, builds a
 * playlist and plays it; the player's browser really plays the same track at the same spot,
 * with their own volume; ambient layer, one-shot effect, server-side auto-advance, pause,
 * reload restore, stop all. Usage: BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase6.e2e.cjs
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




const F = (n) => path.join(__dirname, "fixtures", n);

/** State of the page's <audio> elements, as the browser actually has them. */
async function audioState(page) {
  return page.evaluate(() => {
    const el = (a) => ({ track: a.dataset.track ?? a.dataset.layer, paused: a.paused, time: a.currentTime, volume: Math.round(a.volume * 1000) / 1000, ready: a.readyState });
    return {
      music: [...document.querySelectorAll('[data-testid="audio-music"]')].map(el)[0] ?? null,
      ambient: [...document.querySelectorAll('[data-testid="audio-ambient"]')].map(el),
      sfx: Number(document.querySelector('[data-testid="audio-dock"]')?.dataset.sfxCount ?? 0),
    };
  });
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
    p.on("dialog", (d) => d.accept());
  }
  const unblock = async (page) => {
    // Browsers block audio until the listener has interacted with the page.
    const b = page.getByTestId("audio-unblock");
    if (await b.count()) await b.click();
  };

  // --- Setup through the API ---
  await dm.goto(`${BASE}/login`);
  await call(dm, "POST", "/api/auth/register", { email: `dm6${uniq}@example.com`, username: `dm6${uniq}`, password: "a-strong-password", displayName: "Mira" });
  const { campaign } = await call(dm, "POST", "/api/campaigns", { name: "Songs of Brindle", rulesetId: "dnd5e-2014" });
  const detail = await call(dm, "GET", `/api/campaigns/${campaign.id}`);
  await call(dm, "POST", `/api/campaigns/${campaign.id}/scenes`, { name: "The Prancing Goat", width: 1400, height: 1000 });
  await pl.goto(`${BASE}/login`);
  await call(pl, "POST", "/api/auth/guest", { displayName: "Bram" });
  await call(pl, "POST", `/api/invitations/${detail.invitations[0].code}/accept`, {});

  await dm.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await dm.getByTestId("map-canvas").waitFor();
  await pl.goto(`${BASE}/campaigns/${campaign.id}/table`);
  await pl.getByTestId("map-canvas").waitFor();

  // Players don't get the soundboard or the library.
  assert.equal(await pl.getByTestId("open-music").count(), 0);
  const denied = await pl.evaluate(async (id) => (await fetch(`/api/campaigns/${id}/audio`)).status, campaign.id);
  assert.equal(denied, 403);

  // --- 1. Upload music, ambience and an effect ---
  await dm.getByTestId("open-music").click();
  await dm.getByTestId("music-tab-library").click();
  await dm.getByTestId("audio-file").setInputFiles([F("tavern-tune.wav"), F("battle-drums.wav")]);
  await dm.getByTestId("track-tavern tune").waitFor();
  await dm.getByTestId("track-battle drums").waitFor();
  await dm.getByTestId("audio-upload-category").selectOption("ambient");
  await dm.getByTestId("audio-file").setInputFiles(F("rain.wav"));
  await dm.getByTestId("track-rain").waitFor();
  await dm.getByTestId("audio-upload-category").selectOption("sfx");
  await dm.getByTestId("audio-file").setInputFiles(F("thunder.wav"));
  await dm.getByTestId("track-thunder").waitFor();
  // Durations were measured in the browser and stored.
  await dm.getByTestId("track-tavern tune").getByText("0:04").waitFor();
  await shot(dm, "p6-01-library");

  // --- 2. Build a playlist ---
  await dm.getByTestId("music-tab-playlists").click();
  await dm.getByTestId("playlist-new").click();
  await dm.getByTestId("playlist-name").fill("Tavern night");
  await dm.getByTestId("playlist-pick").selectOption({ label: "tavern tune" });
  await dm.getByTestId("playlist-add").click();
  await dm.getByTestId("playlist-pick").selectOption({ label: "battle drums" });
  await dm.getByTestId("playlist-add").click();
  await dm.getByTestId("playlist-save").click();
  await dm.getByTestId("playlist-Tavern night").getByText("(2 tracks)").waitFor();
  await shot(dm, "p6-02-playlists");

  // --- 3. Play it: the player's browser really plays the same track ---
  await dm.getByTestId("playlist-play-Tavern night").click();
  await pl.getByTestId("audio-now-playing").or(pl.getByTestId("audio-unblock")).first().waitFor();
  await unblock(pl);
  await unblock(dm);
  await waitFor(async () => {
    const s = await audioState(pl);
    return s.music && !s.music.paused && s.music.time > 0.3;
  }, "player's audio element is playing");
  const tavernId = (await audioState(pl)).music.track;
  assert.equal(await pl.getByTestId("audio-now-playing").textContent(), "tavern tune");

  // --- 4. Player sets their own volume (DM 0.8 x music 0.5 x master 0.8) ---
  await pl.getByTestId("audio-volume-toggle").click();
  await pl.getByTestId("vol-music").fill("50");
  await waitFor(async () => (await audioState(pl)).music.volume === 0.32, "player volume applied");
  await shot(pl, "p6-03-player-volume");
  await pl.getByTestId("audio-volume-toggle").click();
  // The DM's own mix is untouched.
  assert.equal((await audioState(dm)).music.volume, 0.64);

  // --- 5. Ambient layer + sound effect ---
  await dm.getByTestId("music-tab-library").click();
  await dm.getByTestId("track-ambient-rain").click();
  await waitFor(async () => {
    const a = (await audioState(pl)).ambient;
    return a.length === 1 && !a[0].paused;
  }, "player hears the rain layer");
  await dm.getByTestId("track-sfx-thunder").click();
  await waitFor(async () => (await audioState(pl)).sfx === 1, "player heard the thunder once");

  // --- 6. Server moves to the next track when the first one ends ---
  await waitFor(async () => {
    const s = await audioState(pl);
    return s.music && s.music.track !== tavernId && !s.music.paused;
  }, "player moved on to track 2", 9000);
  assert.equal(await pl.getByTestId("audio-now-playing").textContent(), "battle drums");

  // --- 7. DM controls: pause, ambience volume ---
  await dm.getByTestId("music-tab-now").click();
  await dm.getByTestId("music-current").getByText("battle drums").waitFor();
  await dm.getByTestId("ambient-layers").waitFor();
  await shot(dm, "p6-04-now-playing");
  await dm.getByTestId("music-pause").click();
  await waitFor(async () => (await audioState(pl)).music.paused, "player paused");

  // --- 8. Reload: the player comes back to the same state ---
  await pl.reload();
  await pl.getByTestId("map-canvas").waitFor();
  await pl.getByTestId("audio-now-playing").waitFor();
  assert.equal(await pl.getByTestId("audio-now-playing").textContent(), "battle drums");
  await waitFor(async () => (await audioState(pl)).ambient.length === 1, "ambient layer restored after reload");
  assert.equal((await audioState(pl)).music.paused, true);

  // --- 9. Stop everything ---
  await dm.getByTestId("music-stop-all").click();
  await waitFor(async () => (await audioState(pl)).ambient.length === 0, "ambience stopped");

  assert.deepEqual(errors, [], `Page errors: ${errors.join("; ")}`);
  console.log("PHASE 6 E2E OK");
  await browser.close();
})().catch((e) => {
  console.error("PHASE 6 E2E FAILED:", e);
  process.exit(1);
});
