import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeText, assistSystem, textModelFromConfig, type TextModel } from "../src/ai/assistant.js";
import { createCampaign, registerUser, setupApp } from "./helpers.js";

class FakeModel implements TextModel {
  readonly name = "fake";
  calls: Array<{ system: string; prompt: string }> = [];
  async complete(system: string, prompt: string) {
    this.calls.push({ system, prompt });
    return "**Mira the ferrywoman** — wary, kind.";
  }
}

const fake = new FakeModel();
let ctx: Awaited<ReturnType<typeof setupApp>>;
let off: Awaited<ReturnType<typeof setupApp>> | undefined;
let dir: string;

beforeAll(async () => {
  ctx = await setupApp({ realtime: false, aiModel: fake }, { AI_PER_HOUR: "3" });
  dir = await mkdtemp(join(tmpdir(), "fake-claude-ai-"));
});
afterAll(async () => {
  await ctx.close();
  await off?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("DM AI assistant", () => {
  it("answers the DM with campaign context, and refuses players", async () => {
    const dm = await registerUser(ctx.app);
    const { id, code } = await createCampaign(dm.client, { rulesetId: "dnd5e-2014", setting: "A drowned river kingdom" });
    const player = await registerUser(ctx.app);
    await player.client.post(`/api/invitations/${code}/accept`);
    const ch = (await player.client.post("/api/characters", { name: "Brakka", rulesetId: "dnd5e-2014", data: { classes: [{ name: "Fighter", level: 3, hitDie: 10 }] } })).json().character;
    await player.client.put(`/api/campaigns/${id}/character`, { characterId: ch.id });
    await dm.client.post(`/api/campaigns/${id}/scenes`, { name: "Old Ferry", dmNotes: "The ferrywoman hides a smuggler's map." });

    expect((await dm.client.get(`/api/campaigns/${id}/ai`)).json()).toEqual({ available: true, provider: "fake" });
    expect((await player.client.get(`/api/campaigns/${id}/ai`)).json()).toEqual({ available: false, provider: null });

    const res = await dm.client.post(`/api/campaigns/${id}/ai/assist`, { mode: "npc", prompt: "ferry operator", language: "th" });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toContain("Mira");
    const call = fake.calls.at(-1)!;
    expect(call.prompt).toBe("ferry operator");
    expect(call.system).toContain("A drowned river kingdom");
    expect(call.system).toContain("Brakka");
    expect(call.system).toContain("smuggler's map");
    expect(call.system).toContain("Thai");
    expect(call.system).toContain("Create one NPC");

    expect((await player.client.post(`/api/campaigns/${id}/ai/assist`, { mode: "ask", prompt: "spoilers?" })).statusCode).toBe(403);
    expect((await dm.client.post(`/api/campaigns/${id}/ai/assist`, { mode: "nope", prompt: "x" })).statusCode).toBe(400);
    // Hourly limit (3 in this test app).
    await dm.client.post(`/api/campaigns/${id}/ai/assist`, { prompt: "a" });
    await dm.client.post(`/api/campaigns/${id}/ai/assist`, { prompt: "b" });
    expect((await dm.client.post(`/api/campaigns/${id}/ai/assist`, { prompt: "c" })).statusCode).toBe(429);
  });

  it("explains how to turn it on when no AI is set up", async () => {
    off = await setupApp({ realtime: false, aiModel: null });
    const dm = await registerUser(off.app);
    const { id } = await createCampaign(dm.client);
    expect((await dm.client.get(`/api/campaigns/${id}/ai`)).json().available).toBe(false);
    const res = await dm.client.post(`/api/campaigns/${id}/ai/assist`, { prompt: "hi" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/AI_PROVIDER=claude-code/);
  });

  it("runs Claude Code with no tools and returns its text", async () => {
    const cmd = join(dir, "claude");
    const log = join(dir, "log.json");
    await writeFile(
      cmd,
      `#!/usr/bin/env node
let p = ""; process.stdin.on("data", (d) => (p += d)); process.stdin.on("end", () => {
  require("fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), prompt: p }));
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "  A misty dock.  " }));
});`,
    );
    await chmod(cmd, 0o755);
    const m = new ClaudeCodeText({ command: cmd });
    expect(await m.complete("SYS", "describe the dock")).toBe("A misty dock.");
    const l = JSON.parse(readFileSync(log, "utf8"));
    expect(l.prompt).toBe("describe the dock");
    expect(l.args[l.args.indexOf("--tools") + 1]).toBe("");
    expect(l.args[l.args.indexOf("--system-prompt") + 1]).toBe("SYS");
    expect(textModelFromConfig({ AI_PROVIDER: "claude-code", CLAUDE_CODE_PATH: "claude", IMPORT_MODEL: "m" })?.name).toBe("claude-code");
    expect(textModelFromConfig({ AI_PROVIDER: "auto", CLAUDE_CODE_PATH: "claude", IMPORT_MODEL: "m" })).toBeNull();
    expect(assistSystem("rules", { campaign: { name: "C", setting: "", description: "", houseRules: "" }, rulesetName: "5e", party: [], scene: null, log: [] }, "en")).toContain("System Reference Document");
  });
});
