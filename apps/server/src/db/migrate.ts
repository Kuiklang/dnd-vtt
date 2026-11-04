import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

// CLI entry: `pnpm db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadConfig } = await import("../config.js");
  const { createDb } = await import("./client.js");
  const { db, pool } = createDb(loadConfig().DATABASE_URL);
  await runMigrations(db);
  await pool.end();
  console.log("Migrations applied.");
}
