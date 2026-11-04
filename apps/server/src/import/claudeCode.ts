import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { extractedSheetSchema, type ExtractedSheet } from "@vtt/rules";
import { HttpError } from "../lib/errors.js";
import { SHEET_INSTRUCTIONS, type SheetExtractor, type SheetFile, type SheetMime } from "./extractor.js";

const EXT: Record<SheetMime, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The draft schema as plain JSON Schema (Claude Code rejects the 2020-12 "$schema" key). */
export function sheetJsonSchema(): string {
  const { $schema: _drop, ...schema } = z.toJSONSchema(extractedSheetSchema, { io: "output" });
  return JSON.stringify(schema);
}

const unavailable = (why: string) => new HttpError(503, "import_unavailable", why);

export interface ClaudeCodeOptions {
  /** Path to the `claude` command (default: found on PATH). */
  command: string;
  /** Optional model; empty = whatever the signed-in plan uses by default. */
  model?: string;
  timeoutMs?: number;
}

/**
 * Reads sheets with the Claude Code CLI already installed and signed in on the machine
 * that runs this server, so it uses that person's Claude plan instead of a paid API key.
 * Only works when the server runs on that same computer.
 *
 * The file is written to a private temp folder, and Claude Code runs there with only the
 * Read tool, so it can look at the sheet and nothing else. Arguments are passed as an
 * array (no shell), and the answer is checked against the same schema as the API reader.
 */
export class ClaudeCodeSheetExtractor implements SheetExtractor {
  readonly name = "claude-code";
  private readonly jsonSchema = sheetJsonSchema();

  constructor(private readonly opts: ClaudeCodeOptions) {}

  async extract(file: SheetFile, hint: { rulesetName: string }): Promise<ExtractedSheet> {
    const dir = await mkdtemp(join(tmpdir(), "vtt-sheet-"));
    const name = `sheet.${EXT[file.mime]}`;
    try {
      await writeFile(join(dir, name), file.bytes, { mode: 0o600 });
      const args = [
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        this.jsonSchema,
        "--tools",
        "Read",
        "--allowedTools",
        "Read",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--system-prompt",
        SHEET_INSTRUCTIONS.replace("{RULESET}", hint.rulesetName),
        ...(this.opts.model ? ["--model", this.opts.model] : []),
      ];
      const out = await this.run(args, dir, `Read the file ./${name} (a character sheet) and transcribe it.`);
      return parseResult(out);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private run(args: string[], cwd: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new HttpError(504, "import_timeout", "Reading the sheet took too long. Try a smaller file or fewer pages."));
      }, this.opts.timeoutMs ?? 5 * 60_000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
      child.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          e.code === "ENOENT"
            ? unavailable("Claude Code isn't installed on the computer running the server (or CLAUDE_CODE_PATH is wrong).")
            : e,
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        // A failed run still prints its JSON result (is_error), which explains more than the exit code.
        if (stdout.trim()) resolve(stdout);
        else reject(errorFrom(stderr || `exit code ${code}`));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
  }
}

function errorFrom(text: string): HttpError {
  if (/log ?in|logged in|auth|credential|api key|401/i.test(text))
    return unavailable("Claude Code on the server computer isn't signed in. Run `claude` once there and log in.");
  if (/rate|limit|usage|quota|429/i.test(text))
    return new HttpError(429, "rate_limited", "Your Claude plan's usage limit was reached. Try again later.");
  return new HttpError(502, "import_failed", "Claude Code couldn't read the sheet. Please try again.");
}

/** Turns Claude Code's `--output-format json` answer into a checked draft. Exported for tests. */
export function parseResult(stdout: string): ExtractedSheet {
  let res: { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string };
  try {
    // Older versions print one JSON line; keep the last one that parses.
    const line = stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
    res = JSON.parse(line ?? stdout);
  } catch {
    throw new HttpError(502, "import_failed", "Claude Code returned something unexpected. Please try again.");
  }
  if (res.is_error) throw errorFrom(`${res.subtype ?? ""} ${res.result ?? ""}`);
  let data = res.structured_output;
  if (data === undefined && typeof res.result === "string") {
    try {
      data = JSON.parse(res.result);
    } catch {
      /* falls through to the schema error */
    }
  }
  const parsed = extractedSheetSchema.safeParse(data);
  if (!parsed.success) throw new HttpError(502, "import_failed", "Claude Code's answer didn't match the sheet format. Please try again.");
  return parsed.data;
}
