import pg from "pg";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";

/**
 * Makes sure the game database stores text as UTF-8.
 *
 * On Windows, initdb picks the PC's code page (WIN874 on Thai Windows, WIN1252 on English
 * Windows), and databases created from it inherit that encoding. Such a database rejects
 * characters outside the code page (Thai on WIN1252, or "×", "→", "·" on WIN874) with a 500.
 *
 * - No database yet: create it as UTF-8.
 * - Already UTF-8: nothing to do.
 * - Anything else: build a UTF-8 copy, move every row across, then swap names. The old
 *   database is kept as `<name>_old_<encoding>_<timestamp>` as a backup.
 *
 * `adminUrl` points at a maintenance database (normally `postgres`) on the same server, as a
 * superuser (the embedded server's only user is one).
 */
export async function ensureUtf8Database(adminUrl: string, name: string, log: (msg: string) => void = () => {}): Promise<"created" | "ok" | "converted"> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const q = (sql: string) => admin.query(sql);
    const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const createUtf8 = (db: string) => q(`CREATE DATABASE ${ident(db)} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    const found = await admin.query<{ enc: string }>("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) {
      await createUtf8(name);
      return "created";
    }
    const enc = found.rows[0]!.enc;
    if (enc === "UTF8") return "ok";

    log(`Converting the game database from ${enc} to UTF-8 (one time, your games are kept)...`);
    const tmp = `${name}_utf8`;
    await q(`DROP DATABASE IF EXISTS ${ident(tmp)}`);
    await createUtf8(tmp);
    const urlFor = (db: string) => {
      const u = new URL(adminUrl);
      u.pathname = `/${db}`;
      return u.toString();
    };
    // Same schema on both sides, so rows copy column for column.
    for (const db of [name, tmp]) {
      const { db: d, pool } = createDb(urlFor(db));
      try {
        await runMigrations(d);
      } finally {
        await pool.end();
      }
    }
    await copyAllRows(urlFor(name), urlFor(tmp));

    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ($1, $2) AND pid <> pg_backend_pid()", [name, tmp]);
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const backup = `${name}_old_${enc.toLowerCase()}_${stamp}`;
    await q(`ALTER DATABASE ${ident(name)} RENAME TO ${ident(backup)}`);
    await q(`ALTER DATABASE ${ident(tmp)} RENAME TO ${ident(name)}`);
    log(`Done. The old copy is kept as database "${backup}".`);
    return "converted";
  } finally {
    await admin.end();
  }
}

async function copyAllRows(fromUrl: string, toUrl: string) {
  // The client talks UTF-8, so the old server converts its text to UTF-8 on the way out.
  const from = new pg.Client({ connectionString: fromUrl });
  const to = new pg.Client({ connectionString: toUrl });
  await from.connect();
  await to.connect();
  try {
    const tables = await to.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    await to.query("BEGIN");
    // Skip foreign-key and trigger checks while rows arrive in any order.
    await to.query("SET LOCAL session_replication_role = replica");
    for (const { t } of tables.rows) {
      const tbl = `public."${t.replace(/"/g, '""')}"`;
      const rows = await from.query<{ j: string }>(`SELECT row_to_json(__src)::text AS j FROM ${tbl} __src`);
      for (let i = 0; i < rows.rows.length; i += 200) {
        const batch = `[${rows.rows.slice(i, i + 200).map((r) => r.j).join(",")}]`;
        await to.query(`INSERT INTO ${tbl} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_recordset(NULL::${tbl}, $1::json)`, [batch]);
      }
    }
    // Identity columns continue after the copied values.
    const ids = await to.query<{ t: string; c: string }>(
      "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND is_identity = 'YES'",
    );
    for (const { t, c } of ids.rows) {
      await to.query(
        `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT max("${c.replace(/"/g, '""')}") FROM public."${t.replace(/"/g, '""')}"), 0) + 1, false)`,
        [`public."${t}"`, c],
      );
    }
    await to.query("COMMIT");
  } catch (e) {
    await to.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await from.end();
    await to.end();
  }
}
