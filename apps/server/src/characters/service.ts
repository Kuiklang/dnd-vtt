import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  CHARACTER_SCHEMA_VERSION,
  characterExportSchema,
  getBuiltinRuleset,
  migrateCharacterData,
  type CharacterExport,
  type CharacterKind,
} from "@vtt/rules";
import { ZodError } from "zod";
import type { Db } from "../db/client.js";
import { campaignMembers, characters, type CharacterRow, type User } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { GUEST_LIMITS } from "../auth/service.js";
import { characterSummaryLine, type CampaignService } from "../campaigns/service.js";

export type CharacterAccess = "owner" | "edit" | "view" | "summary";

export interface CharacterSummary {
  id: string;
  name: string;
  kind: CharacterKind;
  ownerId: string;
  portraitUrl: string;
  color: string;
  summary: string;
  access: "summary";
}

export interface CharacterFull {
  id: string;
  name: string;
  kind: CharacterKind;
  ownerId: string;
  campaignId: string | null;
  rulesetId: string;
  data: CharacterRow["data"];
  playerVisible: boolean;
  isTemplate: boolean;
  version: number;
  updatedAt: string;
  access: Exclude<CharacterAccess, "summary">;
}

function toSummary(c: CharacterRow): CharacterSummary {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    ownerId: c.ownerId,
    portraitUrl: c.data.portraitUrl,
    color: c.data.color,
    summary: characterSummaryLine(c.data),
    access: "summary",
  };
}

function toFull(c: CharacterRow, access: CharacterFull["access"]): CharacterFull {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    ownerId: c.ownerId,
    campaignId: c.campaignId,
    rulesetId: c.rulesetId,
    data: c.data,
    playerVisible: c.playerVisible,
    isTemplate: c.isTemplate,
    version: c.version,
    updatedAt: c.updatedAt.toISOString(),
    access,
  };
}

export function validateCharacterData(raw: unknown) {
  try {
    return migrateCharacterData(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      const issues = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      throw badRequest(`Invalid character data: ${issues[0]?.path} ${issues[0]?.message}`, issues);
    }
    throw badRequest(e instanceof Error ? e.message : "Invalid character data");
  }
}

export class CharacterService {
  constructor(
    private readonly db: Db,
    private readonly campaigns: CampaignService,
  ) {}

  private async load(id: string): Promise<CharacterRow> {
    const [c] = await this.db
      .select()
      .from(characters)
      .where(and(eq(characters.id, id), isNull(characters.deletedAt)));
    if (!c) throw notFound("Character");
    return c;
  }

  /**
   * Decides what `userId` may do with a character. Server-side source of truth:
   *  - owner: full edit
   *  - campaign NPC/monster: npc.manage → edit; playerVisible → summary for members
   *  - PC selected in a campaign: character.editAll → edit, character.viewAll → view,
   *    character.viewParty → summary
   */
  async access(c: CharacterRow, userId: string): Promise<CharacterAccess | null> {
    if (c.ownerId === userId) return "owner";
    if (c.campaignId) {
      try {
        const m = await this.campaigns.membership(c.campaignId, userId);
        if (m.caps.has("npc.manage")) return "edit";
        if (c.playerVisible) return "summary";
      } catch {
        return null;
      }
      return null;
    }
    // PCs: find campaigns where this character is in play and the viewer is a member.
    const rows = await this.db
      .select({ campaignId: campaignMembers.campaignId })
      .from(campaignMembers)
      .where(eq(campaignMembers.activeCharacterId, c.id));
    let best: CharacterAccess | null = null;
    const rank = { owner: 4, edit: 3, view: 2, summary: 1 } as const;
    for (const { campaignId } of rows) {
      let m;
      try {
        m = await this.campaigns.membership(campaignId, userId);
      } catch {
        continue;
      }
      const a: CharacterAccess | null = m.caps.has("character.editAll")
        ? "edit"
        : m.caps.has("character.viewAll")
          ? "view"
          : m.caps.has("character.viewParty")
            ? "summary"
            : null;
      if (a && (!best || rank[a] > rank[best])) best = a;
    }
    return best;
  }

  async get(id: string, userId: string): Promise<CharacterFull | CharacterSummary> {
    const c = await this.load(id);
    const a = await this.access(c, userId);
    if (!a) throw notFound("Character");
    return a === "summary" ? toSummary(c) : toFull(c, a);
  }

  async listLibrary(userId: string): Promise<CharacterFull[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(and(eq(characters.ownerId, userId), isNull(characters.campaignId), isNull(characters.deletedAt)))
      .orderBy(desc(characters.updatedAt));
    return rows.map((c) => toFull(c, "owner"));
  }

  /** Campaign NPCs/monsters visible to the viewer. */
  async listCampaignCharacters(campaignId: string, userId: string) {
    const m = await this.campaigns.membership(campaignId, userId);
    const rows = await this.db
      .select()
      .from(characters)
      .where(and(eq(characters.campaignId, campaignId), isNull(characters.deletedAt)))
      .orderBy(characters.name);
    if (m.caps.has("npc.manage")) return rows.map((c) => toFull(c, "edit"));
    return rows.filter((c) => c.playerVisible).map(toSummary);
  }

  async create(
    user: User,
    input: { name: string; kind: CharacterKind; rulesetId: string; data?: unknown; campaignId?: string | null; playerVisible?: boolean },
  ): Promise<CharacterFull> {
    if (!getBuiltinRuleset(input.rulesetId)) throw badRequest(`Unknown ruleset '${input.rulesetId}'`);
    const data = validateCharacterData(input.data ?? {});
    if (input.campaignId) {
      const m = await this.campaigns.require(input.campaignId, user.id, "npc.manage");
      if (input.kind === "pc") throw badRequest("Campaign characters must be NPCs or monsters");
      if (m.campaign.rulesetId !== input.rulesetId) throw badRequest("Ruleset must match the campaign's ruleset");
    } else {
      if (input.playerVisible) throw badRequest("playerVisible only applies to campaign characters");
      if (user.isGuest) {
        const [row] = await this.db
          .select({ n: count() })
          .from(characters)
          .where(and(eq(characters.ownerId, user.id), isNull(characters.deletedAt)));
        if ((row?.n ?? 0) >= GUEST_LIMITS.maxCharacters) {
          throw forbidden(`Guest accounts can keep up to ${GUEST_LIMITS.maxCharacters} characters. Create an account for more.`);
        }
      }
    }
    const [c] = await this.db
      .insert(characters)
      .values({
        ownerId: user.id,
        campaignId: input.campaignId ?? null,
        kind: input.kind,
        name: input.name,
        rulesetId: input.rulesetId,
        data,
        playerVisible: input.playerVisible ?? false,
      })
      .returning();
    return toFull(c!, input.campaignId ? "edit" : "owner");
  }

  async update(
    id: string,
    userId: string,
    input: { expectedVersion: number; name?: string; data?: unknown; rulesetId?: string; playerVisible?: boolean },
  ): Promise<{ character: CharacterFull; affectedCampaigns: string[] }> {
    const c = await this.load(id);
    const access = await this.access(c, userId);
    if (!access) throw notFound("Character");
    if (access !== "owner" && access !== "edit") throw forbidden("You can view but not edit this character");
    if (input.rulesetId !== undefined && input.rulesetId !== c.rulesetId) {
      if (access !== "owner") throw forbidden("Only the owner can change the ruleset");
      if (!getBuiltinRuleset(input.rulesetId)) throw badRequest(`Unknown ruleset '${input.rulesetId}'`);
      if (c.campaignId) throw badRequest("Campaign characters must use the campaign's ruleset");
    }
    if (input.playerVisible !== undefined && !c.campaignId) throw badRequest("playerVisible only applies to campaign characters");
    const data = input.data !== undefined ? validateCharacterData(input.data) : undefined;

    const [updated] = await this.db
      .update(characters)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(data ? { data } : {}),
        ...(input.rulesetId !== undefined ? { rulesetId: input.rulesetId } : {}),
        ...(input.playerVisible !== undefined ? { playerVisible: input.playerVisible } : {}),
        version: input.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(characters.id, id), eq(characters.version, input.expectedVersion)))
      .returning();
    if (!updated) {
      const current = await this.load(id);
      throw conflict("This character was changed elsewhere. Reload to get the latest version.", {
        currentVersion: current.version,
      });
    }
    return { character: toFull(updated, access), affectedCampaigns: await this.campaignsUsing(updated) };
  }

  async campaignsUsing(c: CharacterRow): Promise<string[]> {
    if (c.campaignId) return [c.campaignId];
    const rows = await this.db
      .select({ campaignId: campaignMembers.campaignId })
      .from(campaignMembers)
      .where(eq(campaignMembers.activeCharacterId, c.id));
    return rows.map((r) => r.campaignId);
  }

  async remove(id: string, userId: string): Promise<string[]> {
    const c = await this.load(id);
    const access = await this.access(c, userId);
    if (!access) throw notFound("Character");
    if (access !== "owner" && !(c.campaignId && access === "edit")) throw forbidden("Only the owner can delete this character");
    const affected = await this.campaignsUsing(c);
    await this.db.transaction(async (tx) => {
      await tx.update(characters).set({ deletedAt: new Date() }).where(eq(characters.id, id));
      if (affected.length) {
        await tx
          .update(campaignMembers)
          .set({ activeCharacterId: null })
          .where(and(eq(campaignMembers.activeCharacterId, id), inArray(campaignMembers.campaignId, affected)));
      }
    });
    return affected;
  }

  async duplicate(id: string, user: User): Promise<CharacterFull> {
    const c = await this.load(id);
    const access = await this.access(c, user.id);
    if (access !== "owner" && access !== "edit") throw notFound("Character");
    return this.create(user, {
      name: `${c.name} (copy)`.slice(0, 100),
      kind: c.kind,
      rulesetId: c.rulesetId,
      data: c.data,
      campaignId: c.campaignId,
      playerVisible: c.campaignId ? c.playerVisible : undefined,
    });
  }

  async export(id: string, userId: string): Promise<CharacterExport> {
    const c = await this.get(id, userId);
    if (c.access === "summary") throw forbidden("You can't export this character");
    return {
      format: "vtt-character",
      schemaVersion: CHARACTER_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      character: { name: c.name, kind: c.kind, rulesetId: c.rulesetId, data: c.data },
    };
  }

  async import(user: User, raw: unknown, campaignId?: string | null): Promise<CharacterFull> {
    const parsed = characterExportSchema.safeParse(raw);
    if (!parsed.success) throw badRequest("This file is not a character export (format 'vtt-character')");
    const { character } = parsed.data;
    const kind = campaignId ? (character.kind === "pc" ? "npc" : character.kind) : "pc";
    return this.create(user, {
      name: character.name,
      kind,
      rulesetId: character.rulesetId,
      data: character.data,
      campaignId: campaignId ?? null,
    });
  }
}
