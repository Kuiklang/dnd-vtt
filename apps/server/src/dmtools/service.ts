import { and, asc, desc, eq, sql } from "drizzle-orm";
import { validateFormula, type RollResult } from "@vtt/rules";
import type { Db } from "../db/client.js";
import {
  encounters,
  journalEntries,
  randomTables,
  type EncounterEntry,
  type EncounterRow,
  type JournalRow,
  type RandomTableEntry,
  type RandomTableRow,
} from "../db/schema.js";
import { assetUrl, type AssetService } from "../assets/service.js";
import type { CampaignService, Membership } from "../campaigns/service.js";
import type { ChatService } from "../chat/service.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";

export const MAX_JOURNAL_ENTRIES = 2000;
export const MAX_ENCOUNTERS = 500;
export const MAX_TABLES = 300;

export type JournalVisibility = JournalRow["visibility"];

export interface JournalViewer {
  userId: string;
  /** Has journal.manage (DM, co-DM). */
  manager: boolean;
}

/** Who may read an entry. Personal notes ("author") stay private even from the DM. */
export function canSeeJournal(e: Pick<JournalRow, "visibility" | "authorId" | "sharedWith">, v: JournalViewer): boolean {
  if (e.visibility === "author") return e.authorId === v.userId;
  if (v.manager) return true;
  if (e.visibility === "all") return true;
  if (e.visibility === "selected") return e.sharedWith.includes(v.userId) || e.authorId === v.userId;
  return false;
}

/** Managers edit everything they can see; others edit only their own entries. */
export function canEditJournal(e: Pick<JournalRow, "visibility" | "authorId" | "sharedWith">, v: JournalViewer): boolean {
  if (!canSeeJournal(e, v)) return false;
  return v.manager || e.authorId === v.userId;
}

export interface JournalDto {
  id: string;
  campaignId: string;
  authorId: string | null;
  title: string;
  body: string;
  folder: string;
  visibility: JournalVisibility;
  /** Only sent to people who can edit the entry. */
  sharedWith: string[];
  imageAssetId: string | null;
  imageUrl: string | null;
  pinned: boolean;
  version: number;
  canEdit: boolean;
  updatedAt: string;
}

export function toJournalDto(e: JournalRow, v: JournalViewer): JournalDto {
  const canEdit = canEditJournal(e, v);
  return {
    id: e.id,
    campaignId: e.campaignId,
    authorId: e.authorId,
    title: e.title,
    body: e.body,
    folder: e.folder,
    visibility: e.visibility,
    sharedWith: canEdit ? e.sharedWith : [],
    imageAssetId: e.imageAssetId,
    imageUrl: e.imageAssetId ? assetUrl(e.imageAssetId) : null,
    pinned: e.pinned,
    version: e.version,
    canEdit,
    updatedAt: e.updatedAt.toISOString(),
  };
}

export interface JournalInput {
  title: string;
  body: string;
  folder: string;
  visibility: JournalVisibility;
  sharedWith: string[];
  imageAssetId: string | null;
  pinned: boolean;
}

export interface EncounterDto {
  id: string;
  name: string;
  notes: string;
  entries: EncounterEntry[];
  totalXp: number;
  version: number;
  updatedAt: string;
}

export interface RandomTableDto {
  id: string;
  name: string;
  formula: string;
  entries: RandomTableEntry[];
  version: number;
}

const toEncounterDto = (e: EncounterRow): EncounterDto => ({
  id: e.id,
  name: e.name,
  notes: e.notes,
  entries: e.entries,
  totalXp: e.entries.reduce((s, x) => s + x.xp * x.count, 0),
  version: e.version,
  updatedAt: e.updatedAt.toISOString(),
});

const toTableDto = (t: RandomTableRow): RandomTableDto => ({ id: t.id, name: t.name, formula: t.formula, entries: t.entries, version: t.version });

/** Range a formula can produce, used to check a table's entries cover it. */
export function formulaRange(formula: string): { min: number; max: number } | null {
  const m = /^(\d{0,3})d(\d{1,4})$/i.exec(formula.replace(/\s+/g, ""));
  if (!m) return null;
  const n = Number(m[1] || 1);
  const d = Number(m[2]);
  if (n < 1 || n > 20 || d < 2 || d > 1000) return null;
  return { min: n, max: n * d };
}

/** Problems with a random table (empty = valid): entries must not overlap and must fit the formula. */
export function validateTable(formula: string, entries: RandomTableEntry[]): string[] {
  const errors: string[] = [];
  if (validateFormula(formula) !== null) return ["The formula isn't a valid dice formula"];
  const range = formulaRange(formula);
  if (!range) return ["Use a simple formula such as 1d20, 2d6 or 1d100"];
  if (entries.length === 0) errors.push("Add at least one entry");
  const sorted = [...entries].sort((a, b) => a.min - b.min);
  for (const [i, e] of sorted.entries()) {
    if (e.min > e.max) errors.push(`Entry "${e.text.slice(0, 30)}" has min greater than max`);
    if (e.min < range.min || e.max > range.max) errors.push(`Entry ${e.min}–${e.max} is outside ${range.min}–${range.max}`);
    const prev = sorted[i - 1];
    if (prev && e.min <= prev.max) errors.push(`Entries ${prev.min}–${prev.max} and ${e.min}–${e.max} overlap`);
  }
  return errors;
}

export function pickEntry(entries: RandomTableEntry[], total: number): RandomTableEntry | null {
  return entries.find((e) => total >= e.min && total <= e.max) ?? null;
}

export class DmToolsService {
  constructor(
    private readonly db: Db,
    private readonly campaigns: CampaignService,
    private readonly assets: AssetService,
    private readonly chat: ChatService,
  ) {}

  viewer(m: Membership): JournalViewer {
    return { userId: m.member.userId, manager: m.caps.has("journal.manage") };
  }

  // ---- Journal ---------------------------------------------------------------

  async journalRow(campaignId: string, id: string): Promise<JournalRow> {
    const [row] = await this.db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.campaignId, campaignId)));
    if (!row) throw notFound("Journal entry");
    return row;
  }

  async listJournal(m: Membership): Promise<JournalDto[]> {
    const v = this.viewer(m);
    const rows = await this.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.campaignId, m.campaign.id))
      .orderBy(desc(journalEntries.pinned), asc(journalEntries.folder), asc(journalEntries.title));
    return rows.filter((r) => canSeeJournal(r, v)).map((r) => toJournalDto(r, v));
  }

  async getJournal(m: Membership, id: string): Promise<JournalDto> {
    const row = await this.journalRow(m.campaign.id, id);
    const v = this.viewer(m);
    if (!canSeeJournal(row, v)) throw notFound("Journal entry");
    return toJournalDto(row, v);
  }

  private async checkJournalInput(m: Membership, input: Partial<JournalInput>) {
    const manager = m.caps.has("journal.manage");
    if (m.role === "spectator") throw forbidden("Spectators can't write in the journal");
    if (input.visibility === "gm" && !manager) throw forbidden("Only the DM can make DM-only entries");
    if (input.pinned && !manager) throw forbidden("Only the DM can pin entries");
    if (input.sharedWith?.length) {
      const roles = await this.campaigns.memberRoles(m.campaign.id);
      if (input.sharedWith.some((id) => !roles.has(id))) throw badRequest("You can only share with campaign members");
      input.sharedWith = [...new Set(input.sharedWith)];
    }
    if (input.imageAssetId) {
      const a = await this.assets.requireCampaignAsset(input.imageAssetId, m.campaign.id, m.member.userId);
      if (a.campaignId !== m.campaign.id) throw badRequest("Handout images must be uploaded to this campaign");
    }
  }

  async createJournal(m: Membership, input: JournalInput): Promise<JournalRow> {
    await this.checkJournalInput(m, input);
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(eq(journalEntries.campaignId, m.campaign.id))) as [{ n: number }];
    if (n >= MAX_JOURNAL_ENTRIES) throw badRequest(`A campaign can hold at most ${MAX_JOURNAL_ENTRIES} journal entries`);
    const [row] = await this.db
      .insert(journalEntries)
      .values({ ...input, campaignId: m.campaign.id, authorId: m.member.userId })
      .returning();
    return row!;
  }

  /** Returns the entry before and after, so realtime can tell viewers who lost access. */
  async updateJournal(m: Membership, id: string, expectedVersion: number, patch: Partial<JournalInput>): Promise<{ before: JournalRow; after: JournalRow }> {
    const before = await this.journalRow(m.campaign.id, id);
    const v = this.viewer(m);
    if (!canSeeJournal(before, v)) throw notFound("Journal entry");
    if (!canEditJournal(before, v)) throw forbidden("You can only edit your own entries");
    // A player can't turn someone's shared entry into a DM-only one, and personal notes stay with their author.
    if (patch.visibility === "author" && before.authorId !== m.member.userId) throw forbidden("Only the author can make an entry personal");
    await this.checkJournalInput(m, patch);
    const [after] = await this.db
      .update(journalEntries)
      .set({ ...patch, version: sql`${journalEntries.version} + 1`, updatedAt: new Date() })
      .where(and(eq(journalEntries.id, id), eq(journalEntries.version, expectedVersion)))
      .returning();
    if (!after) throw conflict("This entry was changed by someone else. Reload to see the latest version.", { version: before.version });
    return { before, after };
  }

  async deleteJournal(m: Membership, id: string): Promise<JournalRow> {
    const row = await this.journalRow(m.campaign.id, id);
    if (!canEditJournal(row, this.viewer(m))) throw forbidden("You can only delete your own entries");
    await this.db.delete(journalEntries).where(eq(journalEntries.id, id));
    return row;
  }

  /**
   * "Show handout": makes the entry readable by the chosen players (or everyone) and
   * returns who should get it pushed on screen.
   */
  async showHandout(m: Membership, id: string, to: "all" | string[]): Promise<{ before: JournalRow; after: JournalRow; recipients: "all" | string[] }> {
    if (!m.caps.has("handout.send")) throw forbidden("Only the DM can show handouts");
    const before = await this.journalRow(m.campaign.id, id);
    if (before.visibility === "author" && before.authorId !== m.member.userId) throw notFound("Journal entry");
    let visibility: JournalVisibility = before.visibility;
    let sharedWith = before.sharedWith;
    if (to === "all") visibility = "all";
    else {
      const roles = await this.campaigns.memberRoles(m.campaign.id);
      if (to.length === 0 || to.some((u) => !roles.has(u))) throw badRequest("Choose campaign members to show it to");
      if (visibility !== "all") {
        visibility = "selected";
        sharedWith = [...new Set([...sharedWith, ...to])];
      }
    }
    const [after] = await this.db
      .update(journalEntries)
      .set({ visibility, sharedWith, version: sql`${journalEntries.version} + 1`, updatedAt: new Date() })
      .where(eq(journalEntries.id, id))
      .returning();
    return { before, after: after!, recipients: to };
  }

  // ---- Encounters --------------------------------------------------------------

  async listEncounters(m: Membership): Promise<EncounterDto[]> {
    if (!m.caps.has("npc.manage")) throw forbidden();
    const rows = await this.db.select().from(encounters).where(eq(encounters.campaignId, m.campaign.id)).orderBy(asc(encounters.name));
    return rows.map(toEncounterDto);
  }

  async createEncounter(m: Membership, input: { name: string; notes: string; entries: EncounterEntry[] }): Promise<EncounterDto> {
    if (!m.caps.has("npc.manage")) throw forbidden("Only the DM can build encounters");
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(encounters)
      .where(eq(encounters.campaignId, m.campaign.id))) as [{ n: number }];
    if (n >= MAX_ENCOUNTERS) throw badRequest(`A campaign can hold at most ${MAX_ENCOUNTERS} encounters`);
    const [row] = await this.db.insert(encounters).values({ ...input, campaignId: m.campaign.id }).returning();
    return toEncounterDto(row!);
  }

  async updateEncounter(m: Membership, id: string, expectedVersion: number, patch: Partial<{ name: string; notes: string; entries: EncounterEntry[] }>) {
    if (!m.caps.has("npc.manage")) throw forbidden("Only the DM can edit encounters");
    const [row] = await this.db
      .update(encounters)
      .set({ ...patch, version: sql`${encounters.version} + 1`, updatedAt: new Date() })
      .where(and(eq(encounters.id, id), eq(encounters.campaignId, m.campaign.id), eq(encounters.version, expectedVersion)))
      .returning();
    if (!row) {
      const [exists] = await this.db.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.id, id), eq(encounters.campaignId, m.campaign.id)));
      throw exists ? conflict("This encounter was changed elsewhere. Reload to see the latest version.") : notFound("Encounter");
    }
    return toEncounterDto(row);
  }

  async deleteEncounter(m: Membership, id: string) {
    if (!m.caps.has("npc.manage")) throw forbidden("Only the DM can delete encounters");
    const res = await this.db.delete(encounters).where(and(eq(encounters.id, id), eq(encounters.campaignId, m.campaign.id))).returning({ id: encounters.id });
    if (!res.length) throw notFound("Encounter");
  }

  // ---- Random tables -------------------------------------------------------------

  async listTables(m: Membership): Promise<RandomTableDto[]> {
    if (!m.caps.has("tables.manage")) throw forbidden();
    const rows = await this.db.select().from(randomTables).where(eq(randomTables.campaignId, m.campaign.id)).orderBy(asc(randomTables.name));
    return rows.map(toTableDto);
  }

  async createTable(m: Membership, input: { name: string; formula: string; entries: RandomTableEntry[] }): Promise<RandomTableDto> {
    if (!m.caps.has("tables.manage")) throw forbidden("Only the DM can create random tables");
    const errors = validateTable(input.formula, input.entries);
    if (errors.length) throw badRequest(errors[0]!, errors);
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(randomTables)
      .where(eq(randomTables.campaignId, m.campaign.id))) as [{ n: number }];
    if (n >= MAX_TABLES) throw badRequest(`A campaign can hold at most ${MAX_TABLES} random tables`);
    const [row] = await this.db.insert(randomTables).values({ ...input, formula: input.formula.replace(/\s+/g, ""), campaignId: m.campaign.id }).returning();
    return toTableDto(row!);
  }

  async updateTable(m: Membership, id: string, expectedVersion: number, patch: Partial<{ name: string; formula: string; entries: RandomTableEntry[] }>) {
    if (!m.caps.has("tables.manage")) throw forbidden("Only the DM can edit random tables");
    const [current] = await this.db.select().from(randomTables).where(and(eq(randomTables.id, id), eq(randomTables.campaignId, m.campaign.id)));
    if (!current) throw notFound("Random table");
    const formula = (patch.formula ?? current.formula).replace(/\s+/g, "");
    const errors = validateTable(formula, patch.entries ?? current.entries);
    if (errors.length) throw badRequest(errors[0]!, errors);
    const [row] = await this.db
      .update(randomTables)
      .set({ ...patch, formula, version: sql`${randomTables.version} + 1`, updatedAt: new Date() })
      .where(and(eq(randomTables.id, id), eq(randomTables.version, expectedVersion)))
      .returning();
    if (!row) throw conflict("This table was changed elsewhere. Reload to see the latest version.");
    return toTableDto(row);
  }

  async deleteTable(m: Membership, id: string) {
    if (!m.caps.has("tables.manage")) throw forbidden("Only the DM can delete random tables");
    const res = await this.db.delete(randomTables).where(and(eq(randomTables.id, id), eq(randomTables.campaignId, m.campaign.id))).returning({ id: randomTables.id });
    if (!res.length) throw notFound("Random table");
  }

  /** Rolls on the server and records it in the dice log (DM-only unless made public). */
  async rollTable(m: Membership, id: string, visibility: "dm_only" | "public") {
    if (!m.caps.has("tables.manage")) throw forbidden("Only the DM can roll on random tables");
    const [t] = await this.db.select().from(randomTables).where(and(eq(randomTables.id, id), eq(randomTables.campaignId, m.campaign.id)));
    if (!t) throw notFound("Random table");
    let entry: RandomTableEntry | null = null;
    const roll = await this.chat.roll(m, {
      formula: t.formula,
      mode: "normal",
      visibility,
      recipientIds: [],
      label: t.name,
      rollType: "table",
      labelFor: (r: RollResult) => {
        entry = pickEntry(t.entries, r.total);
        return `${t.name}: ${entry ? entry.text : "(no entry)"}`.slice(0, 200);
      },
    });
    return { roll, entry: entry as RandomTableEntry | null };
  }
}
