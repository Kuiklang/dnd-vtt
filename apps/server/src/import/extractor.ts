import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { extractedSheetSchema, type ExtractedSheet } from "@vtt/rules";
import { HttpError } from "../lib/errors.js";

export type SheetMime = "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface SheetFile {
  mime: SheetMime;
  bytes: Buffer;
}

/** Reads a character sheet (PDF or photo) into a draft the user reviews. Swappable for tests or other providers. */
export interface SheetExtractor {
  readonly name: string;
  extract(file: SheetFile, hint: { rulesetName: string }): Promise<ExtractedSheet>;
}

export const SHEET_INSTRUCTIONS = `You read tabletop RPG character sheets (D&D 5e and similar) from a PDF or a photo and transcribe them into the given JSON schema.

Transcribe only what is written on the sheet. Never invent values: if a field is blank, illegible or missing, use null (or an empty list), and add its path to uncertainFields when you had to guess between readings (for example "abilities.wis" or "attacks.0.damage").
Ability scores are the large scores (usually 1-30), not the modifiers. Attack bonuses are the printed to-hit numbers as integers. Damage should be a dice expression such as "1d8+3" when one is printed.
Handwriting, other languages and unofficial layouts are fine; keep names as written. Use warnings for anything the user should double-check, such as numbers that don't add up or parts of the page that are cut off.
The campaign uses the ruleset: {RULESET}.`;

/**
 * Claude reads the document directly (PDF pages and images are both supported inputs)
 * and returns schema-validated JSON through structured outputs.
 */
export class ClaudeSheetExtractor implements SheetExtractor {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 5 * 60_000, maxRetries: 2 });
  }

  async extract(file: SheetFile, hint: { rulesetName: string }): Promise<ExtractedSheet> {
    const data = file.bytes.toString("base64");
    const source: Anthropic.Beta.BetaContentBlockParam =
      file.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: file.mime, data } };
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(extractedSheetSchema) },
        system: SHEET_INSTRUCTIONS.replace("{RULESET}", hint.rulesetName),
        messages: [{ role: "user", content: [source, { type: "text", text: "Transcribe this character sheet." }] }],
      });
      if (response.stop_reason === "refusal") throw new HttpError(422, "import_refused", "The sheet couldn't be read. Try a clearer image or enter it by hand.");
      if (response.stop_reason === "max_tokens") throw new HttpError(422, "import_too_long", "The sheet is too long to read in one go. Try fewer pages.");
      const parsed = response.parsed_output;
      if (!parsed) throw new HttpError(502, "import_failed", "The sheet reader returned something unexpected. Please try again.");
      return parsed;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new HttpError(503, "import_unavailable", "Sheet import isn't configured correctly on the server (API key rejected).");
      }
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "rate_limited", "The sheet reader is busy. Try again in a minute.");
      if (e instanceof Anthropic.BadRequestError) throw new HttpError(400, "bad_request", "That file couldn't be read. Use a PDF, PNG, JPEG or WEBP under 10 MB.");
      if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
        throw new HttpError(502, "import_failed", "The sheet reader is unavailable right now. Please try again.");
      }
      throw e;
    }
  }
}
