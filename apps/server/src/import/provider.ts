import type { Config } from "../config.js";
import { ClaudeSheetExtractor, type SheetExtractor } from "./extractor.js";
import { ClaudeCodeSheetExtractor } from "./claudeCode.js";

/**
 * Picks the sheet reader from the server's .env (SHEET_READER, or else AI_PROVIDER):
 * - claude-code: the Claude Code CLI signed in on this computer (no API bill).
 * - api: the Claude API with ANTHROPIC_API_KEY (paid per use).
 * - auto (default): the API if a key is set, otherwise off.
 * - off: disabled; the UI says so.
 */
export function extractorFromConfig(
  cfg: Pick<Config, "SHEET_READER" | "ANTHROPIC_API_KEY" | "IMPORT_MODEL" | "CLAUDE_CODE_PATH" | "CLAUDE_CODE_MODEL"> & Partial<Pick<Config, "AI_PROVIDER">>,
): SheetExtractor | null {
  switch (cfg.SHEET_READER ?? cfg.AI_PROVIDER ?? "auto") {
    case "off":
      return null;
    case "claude-code":
      return new ClaudeCodeSheetExtractor({ command: cfg.CLAUDE_CODE_PATH, model: cfg.CLAUDE_CODE_MODEL || undefined });
    case "api":
    case "auto":
      return cfg.ANTHROPIC_API_KEY ? new ClaudeSheetExtractor(cfg.ANTHROPIC_API_KEY, cfg.IMPORT_MODEL) : null;
  }
}
