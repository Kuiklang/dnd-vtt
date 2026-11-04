import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCampaign, registerUser, setupApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => (ctx = await setupApp({ realtime: false })));
afterAll(() => ctx.close());

describe("campaigns", () => {
  it("creates a campaign with the owner as member and a default invitation", async () => {
    const { client, user } = await registerUser(ctx.app);
    const { detail } = await createCampaign(client, { description: "A test", maxPlayers: 4, password: "secret" });
    expect(detail.campaign).toMatchObject({ name: "Curse of the Test", rulesetId: "dnd5e-2024", maxPlayers: 4, hasPassword: true });
    expect(JSON.stringify(detail)).not.toMatch(/passwordHash|scrypt/);
    expect(detail.me.role).toBe("owner");
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0].userId).toBe(user.id);
    expect(detail.invitations).toHaveLength(1);
    expect(detail.invitations[0].code).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("validates input", async () => {
    const { client } = await registerUser(ctx.app);
    expect((await client.post("/api/campaigns", { name: "", rulesetId: "dnd5e-2024" })).statusCode).toBe(400);
    expect((await client.post("/api/campaigns", { name: "X", rulesetId: "pathfinder" })).statusCode).toBe(400);
    expect((await client.post("/api/campaigns", { name: "X", rulesetId: "dnd5e-2014", maxPlayers: 99 })).statusCode).toBe(400);
  });

  it("lets players join by invite with password and enforces max players", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id, code } = await createCampaign(dm, { maxPlayers: 1, password: "open-sesame" });
    const { client: p1 } = await registerUser(ctx.app);
    const { client: p2 } = await registerUser(ctx.app);

    const preview = await p1.get(`/api/invitations/${code}`);
    expect(preview.json()).toMatchObject({ role: "player", campaign: { requiresPassword: true, players: 0 } });

    expect((await p1.post(`/api/invitations/${code}/accept`, {})).statusCode).toBe(403);
    expect((await p1.post(`/api/invitations/${code}/accept`, { password: "wrong" })).statusCode).toBe(403);
    expect((await p1.post(`/api/invitations/${code}/accept`, { password: "open-sesame" })).statusCode).toBe(200);
    // Idempotent: joining again doesn't duplicate membership.
    expect((await p1.post(`/api/invitations/${code}/accept`, { password: "open-sesame" })).statusCode).toBe(200);
    const full = await p2.post(`/api/invitations/${code}/accept`, { password: "open-sesame" });
    expect(full.statusCode).toBe(409);

    const detail = (await dm.get(`/api/campaigns/${id}`)).json();
    expect(detail.members).toHaveLength(2);
  });

  it("hides campaigns from non-members and invitations from players", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id, code } = await createCampaign(dm);
    const { client: outsider } = await registerUser(ctx.app);
    expect((await outsider.get(`/api/campaigns/${id}`)).statusCode).toBe(404);
    expect((await outsider.get(`/api/campaigns/${id}/chat`)).statusCode).toBe(404);

    const { client: player } = await registerUser(ctx.app);
    await player.post(`/api/invitations/${code}/accept`);
    const pd = (await player.get(`/api/campaigns/${id}`)).json();
    expect(pd.me.role).toBe("player");
    expect(pd.invitations).toEqual([]);
    expect(pd.campaign.permissions).toBeUndefined();
    expect((await player.patch(`/api/campaigns/${id}`, { name: "Hacked" })).statusCode).toBe(403);
    expect((await player.del(`/api/campaigns/${id}`)).statusCode).toBe(403);
    expect((await player.post(`/api/campaigns/${id}/session/start`)).statusCode).toBe(403);
    expect((await player.post(`/api/campaigns/${id}/invitations`, {})).statusCode).toBe(403);
  });

  it("manages invitations: limits, expiry roles and revocation", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id } = await createCampaign(dm);
    const inv = (await dm.post(`/api/campaigns/${id}/invitations`, { role: "spectator", maxUses: 1 })).json().invitation;
    const { client: a } = await registerUser(ctx.app);
    const { client: b } = await registerUser(ctx.app);
    expect((await a.post(`/api/invitations/${inv.code}/accept`)).statusCode).toBe(200);
    expect((await b.post(`/api/invitations/${inv.code}/accept`)).statusCode).toBe(409);
    expect((await a.get(`/api/campaigns/${id}`)).json().me.role).toBe("spectator");

    const inv2 = (await dm.post(`/api/campaigns/${id}/invitations`, {})).json().invitation;
    expect((await dm.del(`/api/campaigns/${id}/invitations/${inv2.id}`)).statusCode).toBe(200);
    expect((await b.post(`/api/invitations/${inv2.code}/accept`)).statusCode).toBe(404);
  });

  it("enforces the role hierarchy when managing members", async () => {
    const { client: owner } = await registerUser(ctx.app);
    const { id, code } = await createCampaign(owner);
    const { client: co, user: coUser } = await registerUser(ctx.app);
    const { client: pl, user: plUser } = await registerUser(ctx.app);
    await co.post(`/api/invitations/${code}/accept`);
    await pl.post(`/api/invitations/${code}/accept`);

    expect((await owner.patch(`/api/campaigns/${id}/members/${coUser.id}`, { role: "co_dm" })).statusCode).toBe(200);
    // Co-DM can't promote someone to DM or touch the owner, but can demote a player to spectator.
    expect((await co.patch(`/api/campaigns/${id}/members/${plUser.id}`, { role: "dm" })).statusCode).toBe(403);
    expect((await co.patch(`/api/campaigns/${id}/members/${plUser.id}`, { role: "spectator" })).statusCode).toBe(200);
    expect((await pl.patch(`/api/campaigns/${id}/members/${coUser.id}`, { role: "spectator" })).statusCode).toBe(403);
    expect((await owner.patch(`/api/campaigns/${id}/members/${plUser.id}`, { role: "owner" })).statusCode).toBe(403);

    // Co-DMs can't edit campaign settings but can run sessions.
    expect((await co.patch(`/api/campaigns/${id}`, { name: "x" })).statusCode).toBe(403);
    expect((await co.post(`/api/campaigns/${id}/session/start`)).statusCode).toBe(200);

    // Kick and leave.
    expect((await co.del(`/api/campaigns/${id}/members/${plUser.id}`)).statusCode).toBe(200);
    expect((await pl.get(`/api/campaigns/${id}`)).statusCode).toBe(404);
    const ownerDetail = (await owner.get(`/api/campaigns/${id}`)).json();
    expect((await owner.del(`/api/campaigns/${id}/members/${ownerDetail.me.userId}`)).statusCode).toBe(400);
  });

  it("transfers ownership", async () => {
    const { client: owner } = await registerUser(ctx.app);
    const { id, code } = await createCampaign(owner);
    const { client: next, user: nextUser } = await registerUser(ctx.app);
    await next.post(`/api/invitations/${code}/accept`);
    expect((await owner.post(`/api/campaigns/${id}/transfer`, { userId: nextUser.id })).statusCode).toBe(400);
    await owner.patch(`/api/campaigns/${id}/members/${nextUser.id}`, { role: "dm" });
    expect((await owner.post(`/api/campaigns/${id}/transfer`, { userId: nextUser.id })).statusCode).toBe(200);
    expect((await next.get(`/api/campaigns/${id}`)).json().me.role).toBe("owner");
    expect((await owner.get(`/api/campaigns/${id}`)).json().me.role).toBe("dm");
  });

  it("supports public campaigns, private (closed) campaigns and the dashboard listing", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const pub = await createCampaign(dm, { name: "Open Table", privacy: "public" });
    const priv = await createCampaign(dm, { name: "Closed Table", privacy: "private" });
    const { client: p } = await registerUser(ctx.app);
    const listed = (await p.get("/api/campaigns/public")).json().campaigns.map((c: { name: string }) => c.name);
    expect(listed).toContain("Open Table");
    expect(listed).not.toContain("Closed Table");
    expect((await p.post(`/api/campaigns/${pub.id}/join`)).statusCode).toBe(200);
    expect((await p.post(`/api/campaigns/${priv.id}/join`)).statusCode).toBe(403);
    expect((await p.post(`/api/invitations/${priv.code}/accept`)).statusCode).toBe(403);

    const mine = (await p.get("/api/campaigns")).json().campaigns;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "Open Table", role: "player", memberCount: 2, activeSessionId: null });
  });

  it("runs game sessions: start, resume idempotently, end", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id } = await createCampaign(dm);
    const s1 = (await dm.post(`/api/campaigns/${id}/session/start`)).json().session;
    expect(s1).toMatchObject({ number: 1, status: "active", name: "Session 1" });
    const again = (await dm.post(`/api/campaigns/${id}/session/start`)).json().session;
    expect(again.id).toBe(s1.id);
    expect((await dm.post(`/api/campaigns/${id}/session/pause`)).json().session.status).toBe("paused");
    expect((await dm.post(`/api/campaigns/${id}/session/start`)).json().session.status).toBe("active");
    expect((await dm.post(`/api/campaigns/${id}/session/end`)).json().session.status).toBe("ended");
    expect((await dm.post(`/api/campaigns/${id}/session/end`)).statusCode).toBe(400);
    const s2 = (await dm.post(`/api/campaigns/${id}/session/start`, { name: "The Return" })).json().session;
    expect(s2).toMatchObject({ number: 2, name: "The Return" });
    const list = (await dm.get("/api/campaigns")).json().campaigns[0];
    expect(list).toMatchObject({ activeSessionId: s2.id, endedSessions: 1 });
  });

  it("soft-deletes campaigns (owner only)", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id } = await createCampaign(dm);
    expect((await dm.del(`/api/campaigns/${id}`)).statusCode).toBe(200);
    expect((await dm.get(`/api/campaigns/${id}`)).statusCode).toBe(404);
    expect((await dm.get("/api/campaigns")).json().campaigns).toHaveLength(0);
  });

  it("validates permission overrides and applies them", async () => {
    const { client: dm } = await registerUser(ctx.app);
    const { id, code } = await createCampaign(dm);
    await dm.patch(`/api/campaigns/${id}`, { permissions: { player: { revoke: ["chat.whisper"], grant: ["dmNotes.view", "bogus"] } } });
    const { client: p } = await registerUser(ctx.app);
    await p.post(`/api/invitations/${code}/accept`);
    const caps = (await p.get(`/api/campaigns/${id}`)).json().me.capabilities as string[];
    expect(caps).not.toContain("chat.whisper");
    expect(caps).not.toContain("dmNotes.view");
  });
});
