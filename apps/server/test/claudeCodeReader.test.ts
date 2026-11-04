import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyExtractedSheet } from "@vtt/rules";
import { ClaudeCodeSheetExtractor, parseResult } from "../src/import/claudeCode.js";
import { extractorFromConfig } from "../src/import/provider.js";
import { pngBytes, registerUser, setupApp, upload } from "./helpers.js";

/**
 * A stand-in `claude` command: checks it was called the safe way (print mode, Read-only,
 * the sheet in its working folder) and answers like Claude Code does, per FAKE_CLAUDE.
 */
const FAKE = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  const mode = process.env.FAKE_CLAUDE;
  const file = (prompt.match(/\\.\\/(sheet\\.\\w+)/) || [])[1];
  fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ args, prompt, cwd: process.cwd(), sawFile: !!file && fs.existsSync(file) }));
  if (mode === "logout") { process.stdout.write(JSON.stringify({ type: "result", is_error: true, subtype: "error", result: "Not logged in · Please run /login" })); return; }
  if (mode === "garbage") { process.stdout.write("hello"); return; }
  if (mode === "crash") { process.stderr.write("boom"); process.exit(1); }
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: ${JSON.stringify({ ...emptyExtractedSheet("Thorin"), maxHp: 38 })} }));
});
`;

let dir: string;
let cmd: string;
const log = () => import("node:fs").then((fs) => JSON.parse(fs.readFileSync(process.env.FAKE_LOG!, "utf8")));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "fake-claude-"));
  cmd = join(dir, "claude");
  await writeFile(cmd, FAKE);
  await chmod(cmd, 0o755);
  process.env.FAKE_LOG = join(dir, "log.json");
});
afterAll(async () => {
  delete process.env.FAKE_CLAUDE;
  await rm(dir, { recursive: true, force: true });
});

describe("sheet reader using Claude Code on this computer", () => {
  it("runs claude in print mode with only the Read tool and returns the checked draft", async () => {
    process.env.FAKE_CLAUDE = "ok";
    const x = new ClaudeCodeSheetExtractor({ command: cmd, model: "sonnet" });
    const d = await x.extract({ mime: "image/png", bytes: pngBytes(10, 10) }, { rulesetName: "D&D 5e (2014)" });
    expect(d).toMatchObject({ name: "Thorin", maxHp: 38 });
    const l = await log();
    expect(l.sawFile).toBe(true);
    expect(l.args).toEqual(expect.arrayContaining(["-p", "--tools", "Read", "--allowedTools", "--json-schema", "--model", "sonnet", "--no-session-persistence"]));
    expect(l.args.join(" ")).toContain("D&D 5e (2014)");
    expect(JSON.parse(l.args[l.args.indexOf("--json-schema") + 1])).not.toHaveProperty("$schema");
    // The temp folder with the sheet is removed afterwards.
    expect((await import("node:fs")).existsSync(l.cwd)).toBe(false);
  });

  it("explains each way it can fail", async () => {
    const x = new ClaudeCodeSheetExtractor({ command: cmd });
    const file = { mime: "application/pdf" as const, bytes: Buffer.from("%PDF-1.7") };
    const hint = { rulesetName: "x" };
    process.env.FAKE_CLAUDE = "logout";
    await expect(x.extract(file, hint)).rejects.toMatchObject({ statusCode: 503, message: expect.stringMatching(/isn't signed in/) });
    process.env.FAKE_CLAUDE = "garbage";
    await expect(x.extract(file, hint)).rejects.toMatchObject({ statusCode: 502 });
    process.env.FAKE_CLAUDE = "crash";
    await expect(x.extract(file, hint)).rejects.toMatchObject({ statusCode: 502 });
    const missing = new ClaudeCodeSheetExtractor({ command: join(dir, "nope") });
    await expect(missing.extract(file, hint)).rejects.toMatchObject({ statusCode: 503, message: expect.stringMatching(/isn't installed/) });
    // An answer that doesn't fit the sheet schema is refused, not passed on.
    expect(() => parseResult(JSON.stringify({ structured_output: { name: 5 } }))).toThrow(/didn't match/);
  });

  it("is picked by SHEET_READER, and the API reader only with a key", () => {
    const base = { IMPORT_MODEL: "m", CLAUDE_CODE_PATH: "claude", CLAUDE_CODE_MODEL: undefined, ANTHROPIC_API_KEY: undefined };
    expect(extractorFromConfig({ ...base, SHEET_READER: "claude-code" })?.name).toBe("claude-code");
    expect(extractorFromConfig({ ...base, SHEET_READER: "auto" })).toBeNull();
    expect(extractorFromConfig({ ...base, SHEET_READER: "auto", ANTHROPIC_API_KEY: "k" })?.name).toBe("claude");
    expect(extractorFromConfig({ ...base, SHEET_READER: "off", ANTHROPIC_API_KEY: "k" })).toBeNull();
  });

  it("works through the import endpoint", async () => {
    process.env.FAKE_CLAUDE = "ok";
    const ctx = await setupApp({ realtime: false }, { SHEET_READER: "claude-code", CLAUDE_CODE_PATH: cmd });
    try {
      const u = await registerUser(ctx.app);
      expect((await u.client.get("/api/characters/import/sheet")).json()).toMatchObject({ available: true });
      const res = await upload(ctx.app, u.client, {}, pngBytes(20, 20), "p.png", "/api/characters/import/sheet");
      expect(res.statusCode).toBe(200);
      expect(res.json().draft.name).toBe("Thorin");
    } finally {
      await ctx.close();
    }
  });
});
