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
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  GUEST_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** Disable rate limiting (tests only). */
  RATE_LIMIT: z
    .enum(["on", "off"])
    .default("on"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(overrides: Record<string, string> = {}): Config {
  return envSchema.parse({ ...process.env, ...overrides });
}
