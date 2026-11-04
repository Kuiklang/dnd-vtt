import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, registerUser, setupApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => (ctx = await setupApp({ realtime: false })));
afterAll(() => ctx.close());

describe("authentication", () => {
  it("registers, reads session, logs out and logs back in", async () => {
    const c = new Client(ctx.app);
    const reg = await c.post("/api/auth/register", { email: "Ann@Example.com", username: "ann", password: "hunter2hunter2" });
    expect(reg.statusCode).toBe(201);
    expect(reg.headers["set-cookie"]).toMatch(/HttpOnly/);
    expect(reg.headers["set-cookie"]).toMatch(/SameSite=Lax/);
    expect(reg.json().user).toMatchObject({ username: "ann", email: "ann@example.com", isGuest: false });
    expect(JSON.stringify(reg.json())).not.toMatch(/password/i);

    expect((await c.get("/api/auth/me")).json().user.username).toBe("ann");
    await c.post("/api/auth/logout");
    expect((await c.get("/api/auth/me")).json().user).toBeNull();

    const bad = await c.post("/api/auth/login", { identifier: "ann", password: "wrong-password" });
    expect(bad.statusCode).toBe(401);
    const ok = await c.post("/api/auth/login", { identifier: "ANN@example.com", password: "hunter2hunter2" });
    expect(ok.statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).json().user.username).toBe("ann");
  });

  it("rejects duplicates and weak input", async () => {
    const c = new Client(ctx.app);
    await c.post("/api/auth/register", { email: "dup@example.com", username: "dupe", password: "longenough1" });
    const sameName = await new Client(ctx.app).post("/api/auth/register", { email: "x@example.com", username: "DUPE", password: "longenough1" });
    expect(sameName.statusCode).toBe(409);
    const sameEmail = await new Client(ctx.app).post("/api/auth/register", { email: "DUP@example.com", username: "other", password: "longenough1" });
    expect(sameEmail.statusCode).toBe(409);
    const weak = await new Client(ctx.app).post("/api/auth/register", { email: "w@example.com", username: "weak", password: "short" });
    expect(weak.statusCode).toBe(400);
    const reserved = await new Client(ctx.app).post("/api/auth/register", { email: "g@example.com", username: "guest-abc", password: "longenough1" });
    expect(reserved.statusCode).toBe(400);
  });

  it("requires auth for protected routes and ignores forged cookies", async () => {
    const c = new Client(ctx.app);
    expect((await c.get("/api/campaigns")).statusCode).toBe(401);
    c.cookie = "vtt_session=forged";
    expect((await c.get("/api/campaigns")).statusCode).toBe(401);
  });

  it("blocks cross-origin state-changing requests", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/guest",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      payload: JSON.stringify({ displayName: "x" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("works through a tunnel on this computer: https origin, secure cookie", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/guest",
      remoteAddress: "127.0.0.1",
      headers: {
        host: "table.trycloudflare.com",
        origin: "https://table.trycloudflare.com",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.9",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ displayName: "Tunnel friend" }),
    });
    expect(res.statusCode).toBe(201);
    expect(String(res.headers["set-cookie"])).toMatch(/; Secure/);
    // A forwarded header from anywhere but this computer isn't trusted.
    const direct = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/guest",
      remoteAddress: "198.51.100.7",
      headers: { "x-forwarded-proto": "https", "content-type": "application/json" },
      payload: JSON.stringify({ displayName: "LAN friend" }),
    });
    expect(direct.statusCode).toBe(201);
    expect(String(direct.headers["set-cookie"])).not.toMatch(/Secure/);
  });

  it("supports guests with limits and upgrade to a full account", async () => {
    const g = new Client(ctx.app);
    const res = await g.post("/api/auth/guest", { displayName: "Wanderer" });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.isGuest).toBe(true);
    const create = await g.post("/api/campaigns", { name: "Nope", rulesetId: "dnd5e-2024" });
    expect(create.statusCode).toBe(403);
    for (let i = 0; i < 5; i++) {
      expect((await g.post("/api/characters", { name: `C${i}`, rulesetId: "dnd5e-2024" })).statusCode).toBe(201);
    }
    expect((await g.post("/api/characters", { name: "C6", rulesetId: "dnd5e-2024" })).statusCode).toBe(403);

    const up = await g.post("/api/me/upgrade", { email: "wanderer@example.com", username: "wanderer", password: "a-good-password" });
    expect(up.statusCode).toBe(200);
    expect(up.json().user.isGuest).toBe(false);
    expect((await g.post("/api/campaigns", { name: "Now yes", rulesetId: "dnd5e-2024" })).statusCode).toBe(201);
  });

  it("changes password and revokes other sessions", async () => {
    const { client: a } = await registerUser(ctx.app, "pwuser");
    const b = new Client(ctx.app);
    await b.post("/api/auth/login", { identifier: "pwuser", password: "correct horse battery" });
    expect((await b.get("/api/auth/me")).json().user).not.toBeNull();
    const wrong = await a.post("/api/me/password", { currentPassword: "nope", newPassword: "brand new password" });
    expect(wrong.statusCode).toBe(401);
    const ok = await a.post("/api/me/password", { currentPassword: "correct horse battery", newPassword: "brand new password" });
    expect(ok.statusCode).toBe(200);
    expect((await a.get("/api/auth/me")).json().user).not.toBeNull();
    expect((await b.get("/api/auth/me")).json().user).toBeNull();
  });

  it("updates profile with validation", async () => {
    const { client } = await registerUser(ctx.app);
    const ok = await client.patch("/api/me", { displayName: "Sir Testalot", avatarUrl: "https://example.com/a.png", settings: { diceSound: false } });
    expect(ok.json().user).toMatchObject({ displayName: "Sir Testalot", avatarUrl: "https://example.com/a.png", settings: { diceSound: false } });
    expect((await client.patch("/api/me", { avatarUrl: "javascript:alert(1)" })).statusCode).toBe(400);
    expect((await client.patch("/api/me", { isGuest: true })).statusCode).toBe(400);
  });
});
