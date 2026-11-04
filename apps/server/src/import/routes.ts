import type { FastifyInstance } from "fastify";
import { getBuiltinRuleset } from "@vtt/rules";
import { requireAuth } from "../auth/routes.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { sniffImage } from "../assets/service.js";
import type { SheetExtractor, SheetMime } from "./extractor.js";

export const MAX_SHEET_BYTES = 10 * 1024 * 1024;

export function sniffSheet(buf: Buffer): SheetMime | null {
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return sniffImage(buf);
}

/** Sliding one-hour window per user; each import is a paid API call. */
class HourlyLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly perHour: number) {}
  take(userId: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.perHour) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }
}

/**
 * Character sheet import from a PDF or photo. Returns a *draft* only; the client shows it
 * for review and saves through the normal character API, so nothing is stored here.
 */
export async function sheetImportRoutes(app: FastifyInstance, opts: { extractor: SheetExtractor | null }) {
  const { extractor } = opts;
  const limiter = new HourlyLimiter(app.ctx.config.IMPORT_PER_HOUR);

  app.get("/api/characters/import/sheet", async (req) => {
    requireAuth(req);
    return { available: !!extractor, maxBytes: MAX_SHEET_BYTES };
  });

  app.post("/api/characters/import/sheet", async (req) => {
    const { user } = requireAuth(req);
    if (!extractor) {
      throw new HttpError(503, "import_unavailable", "Reading sheets from PDFs and photos isn't set up on this server yet (needs ANTHROPIC_API_KEY).");
    }
    if (!req.isMultipart()) throw badRequest("Send the file as multipart/form-data");
    let bytes: Buffer | null = null;
    let rulesetId = "dnd5e-2014";
    for await (const part of req.parts({ limits: { fileSize: MAX_SHEET_BYTES, files: 1, fields: 3 } })) {
      if (part.type === "file") {
        bytes = await part.toBuffer();
        if (part.file.truncated) throw badRequest("File is too large (max 10 MB)");
      } else if (part.fieldname === "rulesetId" && typeof part.value === "string") {
        rulesetId = part.value.slice(0, 80);
      }
    }
    if (!bytes) throw badRequest("No file was uploaded");
    const mime = sniffSheet(bytes);
    if (!mime) throw badRequest("Unsupported file type. Use a PDF, PNG, JPEG or WEBP.");
    const ruleset = getBuiltinRuleset(rulesetId);
    if (!ruleset) throw badRequest(`Unknown ruleset '${rulesetId}'`);
    if (!limiter.take(user.id)) throw new HttpError(429, "rate_limited", "You've imported a lot of sheets this hour. Try again later.");
    const draft = await extractor.extract({ mime, bytes }, { rulesetName: ruleset.name });
    req.log.info({ userId: user.id, mime, size: bytes.length, provider: extractor.name }, "sheet imported");
    return { draft, rulesetId };
  });
}
