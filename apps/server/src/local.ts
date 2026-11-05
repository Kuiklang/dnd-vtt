import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { resolveClaudeCommand } from "./ai/claudeCli.js";

/**
 * "Play at home" launcher (`pnpm play`, start-windows.bat): one command that runs everything
 * on this computer, with no database to install. It starts a private PostgreSQL that lives in
 * ./data/db (from the embedded-postgres package, listening on this computer only), applies
 * migrations, serves the built web app on http://localhost:3001 and opens the browser.
 * Settings still come from apps/server/.env (AI_PROVIDER, PORT, ...). Set HOME_DB=external
 * to use DATABASE_URL from .env instead of the built-in database.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = path.resolve(process.env.HOME_DATA_DIR ?? path.join(ROOT, "data"));
const env = process.env;

const say = (msg = "") => console.log(msg);

async function startDatabase(): Promise<{ url: string; stop(): Promise<void> }> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = path.join(DATA, "db");
  const secretFile = path.join(DATA, "db-password.txt");
  mkdirSync(DATA, { recursive: true });
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(18).toString("base64url"), { mode: 0o600 });
  const password = readFileSync(secretFile, "utf8").trim();
  const port = Number(env.HOME_DB_PORT ?? 5433);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "vtt",
    password,
    port,
    persistent: true,
    // Only this computer can reach the database.
    postgresFlags: ["-c", "listen_addresses=localhost"],
    // UTF-8 regardless of the PC's language (Windows would otherwise use its code page).
    initdbFlags: ["--encoding=UTF8", "--lc-collate=C", "--lc-ctype=C"],
    onLog: () => {},
    onError: (e: unknown) => {
      const s = String(e instanceof Error ? e.message : e);
      if (/error|fatal/i.test(s) && !/already exists/i.test(s)) console.error(`[database] ${s.trim()}`);
    },
  });
  if (!existsSync(path.join(dir, "PG_VERSION"))) {
    say("Creating the game database (first run only)...");
    await pg.initialise();
  }
  await pg.start();
  const base = `postgres://vtt:${encodeURIComponent(password)}@localhost:${port}`;
  const { ensureUtf8Database } = await import("./db/utf8.js");
  await ensureUtf8Database(`${base}/postgres`, "vtt", say);
  return { url: `${base}/vtt`, stop: () => pg.stop() };
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

function checkClaudeCode(command: string): boolean {
  const { file, prefixArgs } = resolveClaudeCommand(command);
  const r = spawnSync(file, [...prefixArgs, "--version"], { timeout: 20_000, windowsHide: true, encoding: "utf8" });
  return r.status === 0;
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
  } catch {
    /* no browser to open; the URL is printed anyway */
  }
}

const webDist = path.join(ROOT, "apps", "web", "dist");
if (!existsSync(path.join(webDist, "index.html"))) {
  console.error("The website isn't built yet. Run setup first (setup-windows.bat, or `pnpm setup:play`).");
  process.exit(1);
}

const db = env.HOME_DB === "external" ? null : await startDatabase();
const port = env.PORT ?? "3001";
env.PORT = port;
env.WEB_DIST ??= webDist;
env.WEB_ORIGIN = env.HOME_WEB_ORIGIN ?? `http://localhost:${port}`;
env.UPLOAD_DIR = env.HOME_UPLOAD_DIR ?? path.join(DATA, "uploads");
env.LOG_LEVEL ??= "warn";
if (db) env.DATABASE_URL = db.url;

const config = loadConfig();
const { startServer } = await import("./server.js");
let server: Awaited<ReturnType<typeof startServer>>;
try {
  server = await startServer(config);
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  console.error(err.code === "EADDRINUSE" ? `Port ${port} is already in use. Is Arcane Table already running in another window?` : err);
  await db?.stop();
  process.exit(1);
}

const local = `http://localhost:${port}`;
say("");
say("==============================================");
say("  Arcane Table is running!");
say(`  Open on this computer:   ${local}`);
for (const ip of lanAddresses()) say(`  Friends on the same Wi-Fi: http://${ip}:${port}`);
say("  Friends over the internet: see docs/PLAY_ONLINE.md");
if (config.AI_PROVIDER === "claude-code") say(checkClaudeCode(config.CLAUDE_CODE_PATH) ? "  AI: Claude Code found (free with your Claude plan)" : "  AI: Claude Code not found. Install it and run `claude` once to log in.");
else if (config.AI_PROVIDER === "off" || (config.AI_PROVIDER === "auto" && !config.ANTHROPIC_API_KEY)) say("  AI: off (set AI_PROVIDER=claude-code in apps/server/.env to turn it on)");
say("  Your games are saved in: " + DATA);
say("  To stop: close this window or press Ctrl+C");
say("==============================================");
if (env.HOME_OPEN_BROWSER !== "0") openBrowser(local);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  say("Stopping...");
  await server.close().catch(() => {});
  await db?.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());
