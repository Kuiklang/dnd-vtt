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
  /**
   * Which AI the server uses (sheet import from PDF/photo and the DM's AI assistant):
   * "claude-code" (the Claude Code CLI signed in on this computer, uses your Claude plan,
   * no API bill), "api" (ANTHROPIC_API_KEY, paid per use), "auto" (the API if a key is set,
   * else off) or "off". When off, the UI says so.
   */
  AI_PROVIDER: z.enum(["auto", "api", "claude-code", "off"]).default("auto"),
  /** Optional override just for sheet import (same values as AI_PROVIDER). */
  SHEET_READER: z.enum(["auto", "api", "claude-code", "off"]).optional(),
  /** The `claude` command for SHEET_READER=claude-code (full path if it isn't on PATH). */
  CLAUDE_CODE_PATH: z.string().default("claude"),
  /** Optional model for SHEET_READER=claude-code; empty = your plan's default. */
  CLAUDE_CODE_MODEL: z.string().optional(),
  /** Claude API key for AI_PROVIDER=api/auto. Never sent to browsers. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Model used for sheet import. */
  IMPORT_MODEL: z.string().default("claude-opus-5-5"),
  /** AI assistant requests allowed per DM per hour. */
  AI_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(30),
  /** Sheet imports allowed per user per hour (each one is an AI call). */
  IMPORT_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(10),
  /**
   * Voice chat ICE servers as JSON, e.g. [{"urls":"stun:stun.l.google.com:19302"}] or a TURN
   * server for friends behind strict networks. Default: a public STUN server.
   */
  VOICE_ICE_SERVERS: z.string().optional(),
  /** Server log detail (default: info in production, debug otherwise). */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  /** Disable rate limiting (tests only). */
  RATE_LIMIT: z
    .enum(["on", "off"])
    .default("on"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(overrides: Record<string, string> = {}): Config {
  return envSchema.parse({ ...process.env, ...overrides });
}
