import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  canManageMember,
  getBuiltinRuleset,
  resolveCapabilities,
  sanitizePermissionOverrides,
  type CampaignRole,
  type Capability,
} from "@vtt/rules";
import type { Db } from "../db/client.js";
import {
  campaignInvitations,
  campaignMembers,
  campaigns,
  characters,
  gameSessions,
  users,
  type Campaign,
  type CampaignMember,
  type User,
} from "../db/schema.js";
import { hashPassword, newInviteCode, verifyPassword } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { GUEST_LIMITS, toPublicUser } from "../auth/service.js";

export interface Membership {
  campaign: Campaign;
  member: CampaignMember;
  role: CampaignRole;
  caps: Set<Capability>;
}

export interface CampaignInput {
  name: string;
  description: string;
  coverImageUrl: string | null;
  rulesetId: string;
  setting: string;
  theme: string;
  maxPlayers: number;
  privacy: "public" | "invite_only" | "private";
  /** undefined = unchanged, null/"" = remove password. */
  password?: string | null;
  houseRules: string;
  permissions?: unknown;
}

export class CampaignService {
  constructor(private readonly db: Db) {}

  /** Loads the viewer's membership; throws 404 (not 403) so campaign existence isn't leaked. */
  async membership(campaignId: string, userId: string): Promise<Membership> {
    const [row] = await this.db
      .select({ campaign: campaigns, member: campaignMembers })
      .from(campaignMembers)
      .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
      .where(
        and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId), isNull(campaigns.deletedAt)),
      )
      .limit(1);
    if (!row) throw notFound("Campaign");
    const overrides = sanitizePermissionOverrides(row.campaign.settings.permissions);
    return { ...row, role: row.member.role, caps: resolveCapabilities(row.member.role, overrides) };
  }

  async require(campaignId: string, userId: string, cap: Capability): Promise<Membership> {
    const m = await this.membership(campaignId, userId);
    if (!m.caps.has(cap)) throw forbidden();
    return m;
  }

  private validateRuleset(id: string) {
    if (!getBuiltinRuleset(id)) throw badRequest(`Unknown ruleset '${id}'`);
  }

  async create(user: User, input: CampaignInput): Promise<Campaign> {
    if (user.isGuest && !GUEST_LIMITS.canCreateCampaigns) {
      throw forbidden("Guest accounts can join campaigns but not create them. Create a free account to run a game.");
    }
    this.validateRuleset(input.rulesetId);
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx
        .insert(campaigns)
        .values({
          ownerId: user.id,
          name: input.name,
          description: input.description,
          coverImageUrl: input.coverImageUrl,
          rulesetId: input.rulesetId,
          setting: input.setting,
          theme: input.theme,
          maxPlayers: input.maxPlayers,
          privacy: input.privacy,
          passwordHash,
          houseRules: input.houseRules,
          settings: { permissions: sanitizePermissionOverrides(input.permissions) },
        })
        .returning();
      await tx.insert(campaignMembers).values({ campaignId: campaign!.id, userId: user.id, role: "owner" });
      await tx.insert(campaignInvitations).values({
        campaignId: campaign!.id,
        code: newInviteCode(),
        role: "player",
        createdBy: user.id,
      });
      return campaign!;
    });
  }

  async update(m: Membership, input: Partial<CampaignInput>): Promise<Campaign> {
    if (input.rulesetId) this.validateRuleset(input.rulesetId);
    if (input.maxPlayers !== undefined) {
      const players = await this.countPlayers(m.campaign.id);
      if (input.maxPlayers < players) {
        throw badRequest(`There are already ${players} players; max players can't be lower than that`);
      }
    }
    const { password, permissions, ...rest } = input;
    const patch: Partial<typeof campaigns.$inferInsert> = { ...rest, updatedAt: new Date() };
    if (password !== undefined) patch.passwordHash = password ? await hashPassword(password) : null;
    if (permissions !== undefined) {
      patch.settings = { ...m.campaign.settings, permissions: sanitizePermissionOverrides(permissions) };
    }
    const [updated] = await this.db
      .update(campaigns)
      .set({ ...patch, version: sql`${campaigns.version} + 1` })
      .where(eq(campaigns.id, m.campaign.id))
      .returning();
    return updated!;
  }

  async softDelete(campaignId: string): Promise<void> {
    await this.db.update(campaigns).set({ deletedAt: new Date() }).where(eq(campaigns.id, campaignId));
  }

  private async countPlayers(campaignId: string, tx: Pick<Db, "select"> = this.db): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(campaignMembers)
      .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.role, "player")));
    return row?.n ?? 0;
  }

  /** Dashboard listing: every campaign the user belongs to, with status info. */
  async listForUser(userId: string) {
    const rows = await this.db
      .select({
        campaign: campaigns,
        role: campaignMembers.role,
        ownerName: users.displayName,
        memberCount: sql<number>`(select count(*)::int from ${campaignMembers} cm where cm.campaign_id = ${campaigns.id})`,
        activeSessionId: sql<string | null>`(select gs.id from ${gameSessions} gs where gs.campaign_id = ${campaigns.id} and gs.status <> 'ended' limit 1)`,
        endedSessions: sql<number>`(select count(*)::int from ${gameSessions} gs where gs.campaign_id = ${campaigns.id} and gs.status = 'ended')`,
        lastPlayedAt: sql<Date | null>`(select max(coalesce(gs.ended_at, gs.started_at)) from ${gameSessions} gs where gs.campaign_id = ${campaigns.id})`,
      })
      .from(campaignMembers)
      .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
      .innerJoin(users, eq(users.id, campaigns.ownerId))
      .where(and(eq(campaignMembers.userId, userId), isNull(campaigns.deletedAt)))
      .orderBy(desc(campaigns.updatedAt));
    return rows.map((r) => ({
      ...publicCampaign(r.campaign),
      role: r.role,
      ownerName: r.ownerName,
      memberCount: r.memberCount,
      activeSessionId: r.activeSessionId,
      endedSessions: r.endedSessions,
      lastPlayedAt: r.lastPlayedAt ? new Date(r.lastPlayedAt).toISOString() : null,
    }));
  }

  async listPublic(userId: string) {
    const rows = await this.db
      .select({
        campaign: campaigns,
        ownerName: users.displayName,
        players: sql<number>`(select count(*)::int from ${campaignMembers} cm where cm.campaign_id = ${campaigns.id} and cm.role = 'player')`,
        isMember: sql<boolean>`exists(select 1 from ${campaignMembers} cm where cm.campaign_id = ${campaigns.id} and cm.user_id = ${userId})`,
      })
      .from(campaigns)
      .innerJoin(users, eq(users.id, campaigns.ownerId))
      .where(and(eq(campaigns.privacy, "public"), isNull(campaigns.deletedAt)))
      .orderBy(desc(campaigns.createdAt))
      .limit(100);
    return rows.map((r) => ({
      ...publicCampaign(r.campaign),
      ownerName: r.ownerName,
      players: r.players,
      isMember: r.isMember,
    }));
  }

  /** Full lobby detail for a member, filtered by their capabilities. */
  async detail(m: Membership) {
    const memberRows = await this.db
      .select({
        member: campaignMembers,
        user: users,
        character: {
          id: characters.id,
          name: characters.name,
          ownerId: characters.ownerId,
          data: characters.data,
          deletedAt: characters.deletedAt,
        },
      })
      .from(campaignMembers)
      .innerJoin(users, eq(users.id, campaignMembers.userId))
      .leftJoin(characters, eq(characters.id, campaignMembers.activeCharacterId))
      .where(eq(campaignMembers.campaignId, m.campaign.id))
      .orderBy(campaignMembers.joinedAt);

    const [activeSession] = await this.db
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.campaignId, m.campaign.id), sql`${gameSessions.status} <> 'ended'`))
      .limit(1);
    const sessions = await this.db
      .select({
        id: gameSessions.id,
        number: gameSessions.number,
        name: gameSessions.name,
        status: gameSessions.status,
        startedAt: gameSessions.startedAt,
        endedAt: gameSessions.endedAt,
      })
      .from(gameSessions)
      .where(eq(gameSessions.campaignId, m.campaign.id))
      .orderBy(desc(gameSessions.number))
      .limit(20);

    const invitations = m.caps.has("members.invite")
      ? await this.db
          .select()
          .from(campaignInvitations)
          .where(and(eq(campaignInvitations.campaignId, m.campaign.id), isNull(campaignInvitations.revokedAt)))
          .orderBy(desc(campaignInvitations.createdAt))
      : [];

    return {
      campaign: {
        ...publicCampaign(m.campaign),
        houseRules: m.campaign.houseRules,
        ...(m.caps.has("campaign.edit") ? { permissions: m.campaign.settings.permissions ?? {} } : {}),
      },
      me: { userId: m.member.userId, role: m.role, capabilities: [...m.caps], activeCharacterId: m.member.activeCharacterId },
      members: memberRows.map((r) => ({
        userId: r.user.id,
        user: toPublicUser(r.user),
        role: r.member.role,
        joinedAt: r.member.joinedAt.toISOString(),
        character:
          r.character && !r.character.deletedAt
            ? {
                id: r.character.id,
                name: r.character.name,
                ownerId: r.character.ownerId,
                portraitUrl: r.character.data.portraitUrl,
                color: r.character.data.color,
                summary: characterSummaryLine(r.character.data),
              }
            : null,
      })),
      activeSession: activeSession ?? null,
      sessions,
      invitations: invitations.map((i) => ({
        id: i.id,
        code: i.code,
        role: i.role,
        uses: i.uses,
        maxUses: i.maxUses,
        expiresAt: i.expiresAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  // ---- Invitations -------------------------------------------------------

  async createInvitation(
    m: Membership,
    input: { role: CampaignRole; maxUses: number | null; expiresInHours: number | null },
  ) {
    if (input.role === "owner") throw badRequest("Cannot invite as owner");
    // You can only invite people into roles below your own (e.g. co-DMs can't mint DM invites).
    if (input.role !== "player" && input.role !== "spectator" && !canManageMember(m.role, "spectator", input.role)) {
      throw forbidden("You can't invite people with that role");
    }
    const [inv] = await this.db
      .insert(campaignInvitations)
      .values({
        campaignId: m.campaign.id,
        code: newInviteCode(),
        role: input.role,
        createdBy: m.member.userId,
        maxUses: input.maxUses,
        expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600_000) : null,
      })
      .returning();
    return inv!;
  }

  async revokeInvitation(m: Membership, invitationId: string) {
    const rows = await this.db
      .update(campaignInvitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(campaignInvitations.id, invitationId), eq(campaignInvitations.campaignId, m.campaign.id)))
      .returning({ id: campaignInvitations.id });
    if (rows.length === 0) throw notFound("Invitation");
  }

  private async findUsableInvitation(code: string) {
    const [row] = await this.db
      .select({ inv: campaignInvitations, campaign: campaigns })
      .from(campaignInvitations)
      .innerJoin(campaigns, eq(campaigns.id, campaignInvitations.campaignId))
      .where(and(eq(campaignInvitations.code, code.toUpperCase()), isNull(campaigns.deletedAt)))
      .limit(1);
    if (!row || row.inv.revokedAt) throw notFound("Invitation");
    if (row.inv.expiresAt && row.inv.expiresAt < new Date()) throw badRequest("This invitation has expired");
    return row;
  }

  /** Public preview shown on the join page (no membership required). */
  async previewInvitation(code: string, userId: string) {
    const row = await this.findUsableInvitation(code);
    const [owner] = await this.db.select().from(users).where(eq(users.id, row.campaign.ownerId));
    const players = await this.countPlayers(row.campaign.id);
    const [existing] = await this.db
      .select({ role: campaignMembers.role })
      .from(campaignMembers)
      .where(and(eq(campaignMembers.campaignId, row.campaign.id), eq(campaignMembers.userId, userId)));
    return {
      campaign: {
        id: row.campaign.id,
        name: row.campaign.name,
        description: row.campaign.description,
        coverImageUrl: row.campaign.coverImageUrl,
        rulesetId: row.campaign.rulesetId,
        setting: row.campaign.setting,
        maxPlayers: row.campaign.maxPlayers,
        players,
        ownerName: owner?.displayName ?? "Unknown",
        requiresPassword: !!row.campaign.passwordHash,
        closed: row.campaign.privacy === "private",
      },
      role: row.inv.role,
      exhausted: row.inv.maxUses !== null && row.inv.uses >= row.inv.maxUses,
      alreadyMember: existing?.role ?? null,
    };
  }

  /**
   * Adds the user to a campaign. Idempotent: an existing member is returned unchanged.
   * The campaign row is locked so concurrent joins can't exceed max players.
   */
  private async join(
    campaignId: string,
    user: User,
    role: CampaignRole,
    password: string | undefined,
    invitationId: string | null,
  ): Promise<{ member: CampaignMember; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deletedAt)))
        .for("update");
      if (!campaign) throw notFound("Campaign");
      const [existing] = await tx
        .select()
        .from(campaignMembers)
        .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, user.id)));
      if (existing) return { member: existing, created: false };
      if (campaign.privacy === "private") throw forbidden("This campaign is closed to new members");
      if (campaign.passwordHash && !(password && (await verifyPassword(password, campaign.passwordHash)))) {
        throw forbidden(password ? "Incorrect campaign password" : "This campaign requires a password");
      }
      if (role === "player" && (await this.countPlayers(campaignId, tx)) >= campaign.maxPlayers) {
        throw conflict("This campaign is full");
      }
      if (invitationId) {
        const used = await tx
          .update(campaignInvitations)
          .set({ uses: sql`${campaignInvitations.uses} + 1` })
          .where(
            and(
              eq(campaignInvitations.id, invitationId),
              sql`(${campaignInvitations.maxUses} is null or ${campaignInvitations.uses} < ${campaignInvitations.maxUses})`,
            ),
          )
          .returning({ id: campaignInvitations.id });
        if (used.length === 0) throw conflict("This invitation has reached its use limit");
      }
      const [member] = await tx.insert(campaignMembers).values({ campaignId, userId: user.id, role }).returning();
      return { member: member!, created: true };
    });
  }

  async acceptInvitation(code: string, user: User, password?: string) {
    const row = await this.findUsableInvitation(code);
    const result = await this.join(row.campaign.id, user, row.inv.role, password, row.inv.id);
    return { campaignId: row.campaign.id, ...result };
  }

  async joinPublic(campaignId: string, user: User, password?: string) {
    const [c] = await this.db
      .select({ privacy: campaigns.privacy })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deletedAt)));
    if (!c) throw notFound("Campaign");
    if (c.privacy !== "public") throw forbidden("This campaign can only be joined with an invitation");
    return this.join(campaignId, user, "player", password, null);
  }

  // ---- Members -----------------------------------------------------------

  private async targetMember(campaignId: string, userId: string) {
    const [t] = await this.db
      .select()
      .from(campaignMembers)
      .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)));
    if (!t) throw notFound("Member");
    return t;
  }

  async setRole(m: Membership, targetUserId: string, role: CampaignRole) {
    const target = await this.targetMember(m.campaign.id, targetUserId);
    if (!canManageMember(m.role, target.role, role)) throw forbidden("You can't assign that role to this member");
    if (role === "player" && target.role !== "player") {
      if ((await this.countPlayers(m.campaign.id)) >= m.campaign.maxPlayers) throw conflict("The campaign is full");
    }
    await this.db.update(campaignMembers).set({ role }).where(eq(campaignMembers.id, target.id));
  }

  async removeMember(m: Membership, targetUserId: string) {
    const target = await this.targetMember(m.campaign.id, targetUserId);
    if (!canManageMember(m.role, target.role, null)) throw forbidden("You can't remove this member");
    await this.db.delete(campaignMembers).where(eq(campaignMembers.id, target.id));
  }

  async leave(m: Membership) {
    if (m.role === "owner") throw badRequest("The owner can't leave. Transfer ownership or delete the campaign.");
    await this.db.delete(campaignMembers).where(eq(campaignMembers.id, m.member.id));
  }

  async transferOwnership(m: Membership, newOwnerId: string) {
    if (m.role !== "owner") throw forbidden();
    const target = await this.targetMember(m.campaign.id, newOwnerId);
    if (target.role !== "dm" && target.role !== "co_dm") {
      throw badRequest("Promote the member to DM or Co-DM before transferring ownership");
    }
    await this.db.transaction(async (tx) => {
      await tx.update(campaignMembers).set({ role: "dm" }).where(eq(campaignMembers.id, m.member.id));
      await tx.update(campaignMembers).set({ role: "owner" }).where(eq(campaignMembers.id, target.id));
      await tx.update(campaigns).set({ ownerId: newOwnerId, updatedAt: new Date() }).where(eq(campaigns.id, m.campaign.id));
    });
  }

  async selectCharacter(m: Membership, characterId: string | null) {
    if (!m.caps.has("character.selectOwn")) throw forbidden("Your role can't bring a character");
    if (characterId) {
      const [c] = await this.db
        .select()
        .from(characters)
        .where(and(eq(characters.id, characterId), isNull(characters.deletedAt)));
      if (!c || c.ownerId !== m.member.userId) throw notFound("Character");
      if (c.kind !== "pc" || c.campaignId !== null) throw badRequest("Only player characters from your library can be selected");
      if (c.rulesetId !== m.campaign.rulesetId) {
        throw badRequest(`This character uses ${c.rulesetId}, but the campaign uses ${m.campaign.rulesetId}`);
      }
    }
    await this.db
      .update(campaignMembers)
      .set({ activeCharacterId: characterId })
      .where(eq(campaignMembers.id, m.member.id));
  }

  // ---- Game sessions -----------------------------------------------------

  async startSession(m: Membership, name?: string) {
    return this.db.transaction(async (tx) => {
      await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, m.campaign.id)).for("update");
      const [open] = await tx
        .select()
        .from(gameSessions)
        .where(and(eq(gameSessions.campaignId, m.campaign.id), sql`${gameSessions.status} <> 'ended'`));
      if (open) {
        if (open.status === "paused") {
          const [resumed] = await tx
            .update(gameSessions)
            .set({ status: "active" })
            .where(eq(gameSessions.id, open.id))
            .returning();
          return resumed!;
        }
        return open;
      }
      const [{ next } = { next: 1 }] = await tx
        .select({ next: sql<number>`coalesce(max(${gameSessions.number}), 0)::int + 1` })
        .from(gameSessions)
        .where(eq(gameSessions.campaignId, m.campaign.id));
      const [session] = await tx
        .insert(gameSessions)
        .values({
          campaignId: m.campaign.id,
          number: next,
          name: name || `Session ${next}`,
          startedBy: m.member.userId,
        })
        .returning();
      await tx
        .update(campaignMembers)
        .set({ lastPlayedAt: new Date() })
        .where(eq(campaignMembers.campaignId, m.campaign.id));
      return session!;
    });
  }

  async setSessionStatus(m: Membership, status: "paused" | "ended") {
    const [updated] = await this.db
      .update(gameSessions)
      .set({ status, ...(status === "ended" ? { endedAt: new Date() } : {}) })
      .where(and(eq(gameSessions.campaignId, m.campaign.id), sql`${gameSessions.status} <> 'ended'`))
      .returning();
    if (!updated) throw badRequest("No session is running");
    return updated;
  }

  async memberRoles(campaignId: string): Promise<Map<string, CampaignRole>> {
    const rows = await this.db
      .select({ userId: campaignMembers.userId, role: campaignMembers.role })
      .from(campaignMembers)
      .where(eq(campaignMembers.campaignId, campaignId));
    return new Map(rows.map((r) => [r.userId, r.role]));
  }

  async membersByIds(campaignId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select({ userId: campaignMembers.userId })
      .from(campaignMembers)
      .where(and(eq(campaignMembers.campaignId, campaignId), inArray(campaignMembers.userId, ids)));
  }
}

export function publicCampaign(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    coverImageUrl: c.coverImageUrl,
    rulesetId: c.rulesetId,
    setting: c.setting,
    theme: c.theme,
    maxPlayers: c.maxPlayers,
    privacy: c.privacy,
    hasPassword: !!c.passwordHash,
    ownerId: c.ownerId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function characterSummaryLine(data: { classes: { name: string; level: number }[]; species: string }): string {
  const classes = data.classes.map((c) => `${c.name} ${c.level}`).join(" / ");
  return [data.species, classes].filter(Boolean).join(" · ");
}
