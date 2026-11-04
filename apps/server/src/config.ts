import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgres://postgres@localhost:5432/vtt"),
  /** Public origin of the web app (Origin checks, invite links). */
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Directory of the built web app to serve (single-process production deploy). */
  WEB_DIST: z.string().optional(),
  /** Local disk directory for uploaded files (maps, tokens, portraits). */
  UPLOAD_DIR: z.string().default("./data/uploads"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  GUEST_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** Claude API key for reading character sheets from PDFs/photos. Unset = import disabled (UI says so). */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Model used for sheet import. */
  IMPORT_MODEL: z.string().default("claude-opus-5-5"),
  /** Sheet imports allowed per user per hour (each one is a paid API call). */
  IMPORT_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(10),
  /** Disable rate limiting (tests only). */
  RATE_LIMIT: z
    .enum(["on", "off"])
    .default("on"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(overrides: Record<string, string> = {}): Config {
  return envSchema.parse({ ...process.env, ...overrides });
}
