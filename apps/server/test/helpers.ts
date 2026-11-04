import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/vtt_test";

export async function setupApp(opts: { realtime?: boolean } = {}) {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_DB_URL, RATE_LIMIT: "off", WEB_ORIGIN: "http://localhost:5173" });
  const { db, pool } = createDb(TEST_DB_URL);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  const app = await buildApp(config, db, opts);
  return {
    app,
    db,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export class Client {
  cookie = "";
  constructor(private readonly app: FastifyInstance) {}

  async req(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) this.cookie = first.split(";")[0]!;
    return res;
  }
  get = (url: string) => this.req("GET", url);
  post = (url: string, body: unknown = {}) => this.req("POST", url, body);
  put = (url: string, body: unknown) => this.req("PUT", url, body);
  patch = (url: string, body: unknown) => this.req("PATCH", url, body);
  del = (url: string) => this.req("DELETE", url);
}

let seq = 0;
export async function registerUser(app: FastifyInstance, name?: string) {
  const c = new Client(app);
  const n = name ?? `user${++seq}${Date.now() % 100000}`;
  const res = await c.post("/api/auth/register", { email: `${n}@example.com`, username: n, password: "correct horse battery", displayName: n });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return { client: c, user: res.json().user as { id: string; username: string; displayName: string } };
}

export async function createCampaign(c: Client, body: Record<string, unknown> = {}) {
  const res = await c.post("/api/campaigns", { name: "Curse of the Test", rulesetId: "dnd5e-2024", ...body });
  if (res.statusCode !== 201) throw new Error(`create campaign failed: ${res.body}`);
  const id = res.json().campaign.id as string;
  const detail = (await c.get(`/api/campaigns/${id}`)).json();
  return { id, code: detail.invitations[0].code as string, detail };
}
