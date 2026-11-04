/**
 * Phase 1 browser walkthrough: DM + player in two isolated browser contexts.
 * Usage: start the server serving the built web app, then
 *   BASE_URL=http://localhost:3001 SHOTS=./shots node e2e/phase1.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS;
const uniq = Date.now().toString(36);

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1440, height: 900 } };
  const dmCtx = await browser.newContext(vp);
  const plCtx = await browser.newContext(vp);
  const dm = await dmCtx.newPage();
  const pl = await plCtx.newPage();
  const errors = [];
  for (const p of [dm, pl]) p.on("pageerror", (e) => errors.push(e.message));

  // 1. DM registers
  await dm.goto(`${BASE}/login`);
  await shot(dm, "01-login");
  await dm.getByRole("tab", { name: "Create account" }).click();
  await dm.getByLabel("Email").fill(`dm${uniq}@example.com`);
  await dm.getByLabel("Username").fill(`dm${uniq}`);
  await dm.getByLabel("Display name").fill("Mira the DM");
  await dm.getByLabel("Password").fill("a-strong-password");
  await dm.getByRole("button", { name: "Create account" }).last().click();
  await dm.getByText("Welcome back, Mira the DM").waitFor();

  // 2. Create campaign
  await dm.getByRole("button", { name: "+ New campaign" }).click();
  await dm.getByLabel("Campaign name").fill("The Sunken Crypt");
  await dm.getByLabel("Description").fill("A crypt beneath the drowned city.");
  await dm.getByLabel("Ruleset").selectOption("dnd5e-2014");
  await dm.getByLabel("House rules").fill("Potions are a bonus action.");
  await shot(dm, "02-create-campaign");
  await dm.getByRole("button", { name: "Create campaign" }).click();
  await dm.getByRole("heading", { name: "The Sunken Crypt" }).waitFor();
  await dm.getByText("Connected").waitFor();
  const code = (await dm.locator("code").first().textContent()).trim();
  assert.match(code, /^[A-Z2-9]{8}$/);

  // 3. Player opens invite link as a guest
  await pl.goto(`${BASE}/join/${code}`);
  await pl.getByRole("tab", { name: "Play as guest" }).waitFor();
  await pl.getByLabel("Your name at the table").fill("Bram");
  await pl.getByRole("button", { name: "Continue as guest" }).click();
  await pl.getByText("You're invited to").waitFor();
  await shot(pl, "03-join");
  await pl.getByRole("button", { name: "Join campaign" }).click();
  await pl.getByRole("heading", { name: "The Sunken Crypt" }).waitFor();

  // DM sees the new member online (realtime)
  await dm.getByText("Bram").first().waitFor();

  // 4. Player creates a character from the lobby and edits it
  pl.once("dialog", (d) => d.accept("Bram Ironfoot"));
  await pl.getByRole("button", { name: "+ New character" }).click();
  await pl.waitForURL(/\/characters\/.+\?campaign=/);
  await pl.getByRole("button", { name: "+ Add class" }).click();
  await pl.getByLabel("Species").fill("Dwarf");
  await pl.getByLabel("Strength score").fill("16");
  await pl.getByLabel("Strength save proficiency").check();
  await pl.getByRole("button", { name: "Athletics proficiency: none" }).click();
  await pl.getByText("Saved", { exact: true }).waitFor({ timeout: 10000 });
  await shot(pl, "04-character-sheet");
  // STR 16 -> +3, PB +2 at level 1 => save +5, athletics +5
  const athletics = pl.getByTitle("Athletics check");
  assert.equal((await athletics.textContent()).trim(), "+5");
  await athletics.click();
  await pl.getByText("Bram Ironfoot (Bram) · Athletics").first().waitFor();

  await pl.getByRole("tab", { name: "Combat" }).click();
  await pl.getByRole("button", { name: "+ Add attack" }).click();
  await pl.getByLabel("Attack name").fill("Warhammer");
  await pl.getByLabel("Damage formula").fill("1d8");
  await pl.getByText("Saved", { exact: true }).waitFor({ timeout: 10000 });
  assert.ok(await pl.getByRole("button", { name: "+5 to hit" }).isVisible());
  await pl.getByRole("button", { name: /1d8\+3/ }).click();
  await shot(pl, "05-combat");

  // 5. Back to lobby, ready up, chat, roll
  await pl.getByRole("link", { name: "← Back to lobby" }).click();
  await pl.getByRole("heading", { name: "The Sunken Crypt" }).waitFor();
  await pl.getByLabel("Your character").waitFor();
  assert.equal(await pl.getByLabel("Your character").inputValue() !== "", true);
  await pl.getByLabel("I'm ready to play").check();
  await dm.getByText("Ready", { exact: true }).first().waitFor();

  await pl.getByLabel("Message").fill("Hello from Bram!");
  await pl.keyboard.press("Enter");
  await dm.getByText("Hello from Bram!").waitFor();

  // Whisper to DM is visible to DM
  await pl.getByLabel("Chat channel").selectOption("dm");
  await pl.getByLabel("Message").fill("I pocket the gem secretly");
  await pl.keyboard.press("Enter");
  await dm.getByText("I pocket the gem secretly").waitFor();

  // 6. DM starts the session, rolls a blind-for-player? DM rolls DM-only; player must not see it
  await dm.getByRole("button", { name: "Start session" }).click();
  await pl.getByText("Session 1 live").waitFor();
  await dm.getByLabel("Dice formula").fill("1d100");
  await dm.getByLabel("Roll label").fill("Ambush check");
  await dm.getByLabel("Roll visibility").selectOption("dm_only");
  await dm.getByRole("button", { name: "Roll", exact: true }).click();
  await dm.getByText("Mira the DM · Ambush check").waitFor();

  // Player public roll with advantage via dice tray
  await pl.getByLabel("Dice formula").fill("1d20+5");
  await pl.getByLabel("Roll label").fill("Perception");
  await pl.getByRole("radio", { name: "advantage", exact: true }).click();
  await pl.getByRole("button", { name: "Roll", exact: true }).click();
  await dm.getByText("Bram · Perception").waitFor();
  await pl.waitForTimeout(500);
  assert.equal(await pl.getByText("Ambush check").count(), 0, "DM-only roll leaked to player");

  // DM can open the player's sheet
  await dm.getByRole("button", { name: "Bram Ironfoot" }).click();
  await dm.getByRole("dialog").getByLabel("Character name").waitFor();
  await shot(dm, "06-dm-views-sheet");
  await dm.getByRole("button", { name: "Close" }).click();
  await shot(dm, "07-dm-lobby");
  await shot(pl, "08-player-lobby");

  // 7. Reconnect: reload player page; state persists and no duplicates
  await pl.reload();
  await pl.getByText("Hello from Bram!").waitFor();
  assert.equal(await pl.getByText("Hello from Bram!").count(), 1);
  await dm.getByText("Online").first().waitFor();

  // Mobile layout smoke test
  await pl.setViewportSize({ width: 390, height: 844 });
  await pl.waitForTimeout(300);
  await shot(pl, "09-player-mobile");
  const overflow = await pl.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `Horizontal overflow on mobile lobby: ${overflow}px`);
  await pl.goto(`${BASE}/`);
  await pl.getByText("Character library").waitFor();
  const overflow2 = await pl.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow2 <= 1, `Horizontal overflow on mobile dashboard: ${overflow2}px`);
  await shot(pl, "10-dashboard-mobile");

  assert.deepEqual(errors, [], `Page errors: ${errors.join("; ")}`);
  console.log("E2E OK — invite code", code);
  await browser.close();
})().catch(async (e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
