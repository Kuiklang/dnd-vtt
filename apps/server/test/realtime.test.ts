import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createCampaign, registerUser, setupApp } from "./helpers.js";
import { RECONNECT_GRACE_MS } from "../src/realtime/socket.js";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await setupApp();
  await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = ctx.app.server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.close();
});

function open(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { extraHeaders: { cookie }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

function emit<T = unknown>(s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}

function collect(s: Socket, event: string) {
  const items: any[] = [];
  s.on(event, (p) => items.push(p));
  return items;
}

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function table() {
  const dm = await registerUser(ctx.app);
  const { id, code } = await createCampaign(dm.client);
  const alice = await registerUser(ctx.app);
  const bob = await registerUser(ctx.app);
  const spec = await registerUser(ctx.app);
  await alice.client.post(`/api/invitations/${code}/accept`);
  await bob.client.post(`/api/invitations/${code}/accept`);
  const specInv = (await dm.client.post(`/api/campaigns/${id}/invitations`, { role: "spectator" })).json().invitation;
  await spec.client.post(`/api/invitations/${specInv.code}/accept`);
  const s = {
    dm: await open(dm.client.cookie),
    alice: await open(alice.client.cookie),
    bob: await open(bob.client.cookie),
    spec: await open(spec.client.cookie),
  };
  for (const sock of Object.values(s)) expect((await emit(sock, "campaign:join", { campaignId: id })).ok).toBe(true);
  return { id, dm, alice, bob, spec, s };
}

describe("realtime lobby", () => {
  it("rejects unauthenticated sockets and non-members", async () => {
    await expect(open("vtt_session=nope")).rejects.toThrow(/unauthorized/);
    const { id } = await table();
    const outsider = await registerUser(ctx.app);
    const sock = await open(outsider.client.cookie);
    const res = await emit(sock, "campaign:join", { campaignId: id });
    expect(res).toMatchObject({ ok: false, error: "Campaign not found" });
  });

  it("tracks presence, ready state and reconnecting status", async () => {
    const { id, alice, s } = await table();
    const updates = collect(s.dm, "presence:update");
    expect((await emit(s.alice, "lobby:ready", { campaignId: id, ready: true })).ok).toBe(true);
    await tick();
    const last = updates.at(-1).presence;
    expect(last).toHaveLength(4);
    expect(last.find((p: any) => p.userId === alice.user.id)).toMatchObject({ status: "online", ready: true });

    s.alice.disconnect();
    await tick();
    expect(updates.at(-1).presence.find((p: any) => p.userId === alice.user.id)).toMatchObject({ status: "reconnecting", ready: true });

    // Reconnect within grace: same user is online again, no duplicate entry.
    const again = await open(alice.client.cookie);
    await emit(again, "campaign:join", { campaignId: id });
    await tick();
    const after = updates.at(-1).presence;
    expect(after.filter((p: any) => p.userId === alice.user.id)).toHaveLength(1);
    expect(after.find((p: any) => p.userId === alice.user.id).status).toBe("online");
    expect(RECONNECT_GRACE_MS).toBeGreaterThan(1000);
  });

  it("delivers chat by channel without leaking private messages", async () => {
    const { id, bob, s } = await table();
    const got = { dm: collect(s.dm, "chat:message"), alice: collect(s.alice, "chat:message"), bob: collect(s.bob, "chat:message"), spec: collect(s.spec, "chat:message") };
    await emit(s.alice, "chat:send", { campaignId: id, channel: "global", content: "Hello table" });
    await emit(s.alice, "chat:send", { campaignId: id, channel: "party", content: "Party plan" });
    await emit(s.alice, "chat:send", { campaignId: id, channel: "dm", content: "Psst DM" });
    await emit(s.alice, "chat:send", { campaignId: id, channel: "whisper", content: "Hi Bob", recipientIds: [bob.user.id] });
    await tick(300);
    const texts = (arr: any[]) => arr.map((m) => m.content).sort();
    expect(texts(got.dm)).toEqual(["Hello table", "Party plan", "Psst DM"].sort());
    expect(texts(got.alice)).toEqual(["Hello table", "Party plan", "Psst DM", "Hi Bob"].sort());
    expect(texts(got.bob)).toEqual(["Hello table", "Party plan", "Hi Bob"].sort());
    expect(texts(got.spec)).toEqual(["Hello table"]);

    // History respects the same rules.
    const hist = (await bob.client.get(`/api/campaigns/${id}/chat`)).json().messages.map((m: any) => m.content);
    expect(hist).toContain("Hi Bob");
    expect(hist).not.toContain("Psst DM");

    // Validation and permissions.
    expect((await emit(s.alice, "chat:send", { campaignId: id, channel: "whisper", content: "x", recipientIds: [] })).ok).toBe(false);
    expect((await emit(s.spec, "chat:send", { campaignId: id, channel: "party", content: "x" })).ok).toBe(false);
    expect((await emit(s.alice, "chat:send", { campaignId: id, channel: "system", content: "fake" })).ok).toBe(false);
  });

  it("edits and deletes messages with ownership checks", async () => {
    const { id, s } = await table();
    const sent = await emit<any>(s.alice, "chat:send", { campaignId: id, channel: "global", content: "typo" });
    const msgId = sent.data.id;
    expect((await emit(s.bob, "chat:edit", { campaignId: id, messageId: msgId, content: "hacked" })).ok).toBe(false);
    const edited = await emit<any>(s.alice, "chat:edit", { campaignId: id, messageId: msgId, content: "fixed" });
    expect(edited.data).toMatchObject({ content: "fixed" });
    expect(edited.data.editedAt).not.toBeNull();
    expect((await emit(s.bob, "chat:delete", { campaignId: id, messageId: msgId })).ok).toBe(false);
    const del = await emit<any>(s.dm, "chat:delete", { campaignId: id, messageId: msgId });
    expect(del.data).toMatchObject({ deleted: true, content: "" });
  });

  it("rolls dice server-side with per-viewer visibility", async () => {
    const { id, bob, s } = await table();
    const got = { dm: collect(s.dm, "dice:roll"), alice: collect(s.alice, "dice:roll"), bob: collect(s.bob, "dice:roll"), spec: collect(s.spec, "dice:roll") };

    expect((await emit(s.alice, "dice:roll", { campaignId: id, formula: "1d20+5", label: "Perception" })).ok).toBe(true);
    expect((await emit(s.alice, "dice:roll", { campaignId: id, formula: "1d20", visibility: "blind", label: "Insight" })).ok).toBe(true);
    expect((await emit(s.alice, "dice:roll", { campaignId: id, formula: "2d6", visibility: "whisper", recipientIds: [bob.user.id] })).ok).toBe(true);
    expect((await emit(s.alice, "dice:roll", { campaignId: id, formula: "1d4", visibility: "private" })).ok).toBe(true);
    expect((await emit(s.dm, "dice:roll", { campaignId: id, formula: "1d100", visibility: "dm_only", label: "Ambush" })).ok).toBe(true);
    await tick(300);

    const pub = got.bob.find((r) => r.label === "Perception");
    expect(pub.total).toBeGreaterThanOrEqual(6);
    expect(pub.result.terms[0].dice).toHaveLength(1);

    const blindForAlice = got.alice.find((r) => r.label === "Insight");
    expect(blindForAlice.redacted).toBe(true);
    expect(blindForAlice.total).toBeUndefined();
    expect(blindForAlice.result).toBeUndefined();
    expect(got.dm.find((r) => r.label === "Insight").total).toBeGreaterThanOrEqual(1);
    expect(got.bob.find((r) => r.label === "Insight")).toBeUndefined();

    expect(got.bob.filter((r) => r.visibility === "whisper")).toHaveLength(1);
    expect(got.spec.filter((r) => r.visibility === "whisper")).toHaveLength(0);
    expect(got.dm.filter((r) => r.visibility === "private")).toHaveLength(1);
    expect(got.bob.filter((r) => r.visibility === "private")).toHaveLength(0);
    expect(got.alice.find((r) => r.label === "Ambush")).toBeUndefined();
    expect(got.spec.map((r) => r.label)).toEqual(["Perception"]);

    // History filters the same way.
    const aliceHist = (await bob.client.get(`/api/campaigns/${id}/rolls`)).json().rolls;
    expect(aliceHist.map((r: any) => r.visibility).sort()).toEqual(["public", "whisper"]);

    // Permissions and validation.
    expect((await emit(s.alice, "dice:roll", { campaignId: id, formula: "1d20", visibility: "dm_only" })).ok).toBe(false);
    expect((await emit(s.spec, "dice:roll", { campaignId: id, formula: "1d20" })).ok).toBe(false);
    const bad = await emit(s.alice, "dice:roll", { campaignId: id, formula: "1d20; drop table users" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Unexpected/);
  });

  it("applies advantage server-side and records the session", async () => {
    const { id, dm, s } = await table();
    await dm.client.post(`/api/campaigns/${id}/session/start`);
    const r = await emit<any>(s.alice, "dice:roll", { campaignId: id, formula: "1d20+2", mode: "advantage" });
    expect(r.ok).toBe(true);
    const hist = (await dm.client.get(`/api/campaigns/${id}/rolls`)).json().rolls.at(-1);
    expect(hist.formula).toBe("2d20kh1+2");
    expect(hist.result.terms[0].dice).toHaveLength(2);
  });

  it("notifies lobby of changes and removes kicked members from the room", async () => {
    const { id, dm, bob, s } = await table();
    const changes = collect(s.alice, "campaign:changed");
    const removed = collect(s.bob, "campaign:removed");
    await dm.client.post(`/api/campaigns/${id}/session/start`);
    await dm.client.del(`/api/campaigns/${id}/members/${bob.user.id}`);
    await tick(300);
    expect(changes.map((c) => c.reason)).toEqual(expect.arrayContaining(["session", "members"]));
    expect(removed).toEqual([{ campaignId: id }]);
    const bobChats = collect(s.bob, "chat:message");
    await emit(s.alice, "chat:send", { campaignId: id, channel: "global", content: "after kick" });
    await tick();
    expect(bobChats).toHaveLength(0);
    expect((await emit(s.bob, "chat:send", { campaignId: id, channel: "global", content: "still here?" })).ok).toBe(false);
  });

  it("rate limits event floods", async () => {
    const { id, s } = await table();
    const results = await Promise.all(Array.from({ length: 50 }, () => emit(s.alice, "dice:roll", { campaignId: id, formula: "1d4" })));
    expect(results.some((r) => r.error === "You're doing that too fast")).toBe(true);
  });
});
