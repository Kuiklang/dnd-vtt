import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { ensureUtf8Database } from "../src/db/utf8.js";
import { TEST_DB_URL } from "./helpers.js";

const adminUrl = (() => {
  const u = new URL(TEST_DB_URL);
  u.pathname = "/postgres";
  return u.toString();
})();
const urlFor = (db: string) => {
  const u = new URL(TEST_DB_URL);
  u.pathname = `/${db}`;
  return u.toString();
};
const NAME = "vtt_enc_test";

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const dropAll = () =>
  admin(async (c) => {
    const dbs = await c.query<{ d: string }>("SELECT datname AS d FROM pg_database WHERE datname LIKE $1", [`${NAME}%`]);
    for (const { d } of dbs.rows) await c.query(`DROP DATABASE "${d}" WITH (FORCE)`);
  });

describe("ensureUtf8Database", () => {
  afterAll(dropAll);

  it("creates a missing database as UTF-8 and leaves a UTF-8 one alone", async () => {
    await dropAll();
    expect(await ensureUtf8Database(adminUrl, NAME)).toBe("created");
    expect(await ensureUtf8Database(adminUrl, NAME)).toBe("ok");
  });

  it("converts a code-page database (as Thai Windows makes) and keeps every row", async () => {
    await dropAll();
    await admin((c) => c.query(`CREATE DATABASE ${NAME} TEMPLATE template0 ENCODING 'WIN874' LC_COLLATE 'C' LC_CTYPE 'C'`));
    const { db, pool } = createDb(urlFor(NAME));
    await runMigrations(db);
    await pool.query(`INSERT INTO users (username, display_name, settings) VALUES ('kuik', 'ผู้คุมเกม', '{"tags":["a","b"]}')`);
    await expect(pool.query(`UPDATE users SET display_name = '2×3 → ·'`)).rejects.toThrow();
    await pool.end();

    const logs: string[] = [];
    expect(await ensureUtf8Database(adminUrl, NAME, (m) => logs.push(m))).toBe("converted");
    expect(logs.join("\n")).toContain("WIN874");

    const c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    try {
      expect((await c.query("SHOW server_encoding")).rows[0].server_encoding).toBe("UTF8");
      const u = (await c.query("SELECT display_name, settings FROM users")).rows;
      expect(u).toEqual([{ display_name: "ผู้คุมเกม", settings: { tags: ["a", "b"] } }]);
      await c.query(`UPDATE users SET display_name = '2×3 → ·'`);
      const mig = await c.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
      expect(mig.rows[0].n).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
    const backups = await admin((a) => a.query("SELECT datname FROM pg_database WHERE datname LIKE $1", [`${NAME}_old_win874_%`]));
    expect(backups.rowCount).toBe(1);
  });
});
