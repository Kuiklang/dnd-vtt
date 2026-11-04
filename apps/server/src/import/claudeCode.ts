import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { extractedSheetSchema, type ExtractedSheet } from "@vtt/rules";
import { HttpError } from "../lib/errors.js";
import { parseCliOutput, runClaudeCli, type ClaudeCliOptions, type ClaudeCliResult } from "../ai/claudeCli.js";
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

export type ClaudeCodeOptions = ClaudeCliOptions;

/**
 * Reads sheets with the Claude Code CLI already installed and signed in on the machine
 * that runs this server, so it uses that person's Claude plan instead of a paid API key.
 * Only works when the server runs on that same computer.
 *
 * The file is written to a private temp folder, and Claude Code runs there with only the
 * Read tool, so it can look at the sheet and nothing else. The answer is checked against
 * the same schema as the API reader.
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
      const res = await runClaudeCli(
        this.opts,
        ["--json-schema", this.jsonSchema, "--tools", "Read", "--allowedTools", "Read", "--system-prompt", SHEET_INSTRUCTIONS.replace("{RULESET}", hint.rulesetName)],
        dir,
        `Read the file ./${name} (a character sheet) and transcribe it.`,
      );
      return checkSheet(res);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function checkSheet(res: ClaudeCliResult): ExtractedSheet {
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

/** Turns Claude Code's `--output-format json` answer into a checked draft. Exported for tests. */
export function parseResult(stdout: string): ExtractedSheet {
  return checkSheet(parseCliOutput(stdout));
}
