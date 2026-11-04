import { buildApp } from "./app.js";
import type { Config } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

/** Migrates the database, then starts the HTTP + realtime server. */
export async function startServer(config: Config) {
  const { db, pool } = createDb(config.DATABASE_URL);
  await runMigrations(db);
  const app = await buildApp(config, db);
  await app.listen({ port: config.PORT, host: config.HOST });
  return {
    app,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
