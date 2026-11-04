import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  abilityModifier,
  deriveCharacter,
  getBuiltinRuleset,
  getSrdSpell,
  planCast,
  type CharacterData,
  type RollVisibility,
  type SpellCastPlan,
  type SrdSpell,
} from "@vtt/rules";
import type { Db } from "../db/client.js";
import { campaignMembers, characters, type CharacterRow } from "../db/schema.js";
import type { Membership } from "../campaigns/service.js";
import { rollForViewer, viewerFor, type ChatService, type RollDto } from "../chat/service.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";

const ORDINAL = ["cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const ABILITY_NAME: Record<string, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };

export interface CastInput {
  spellId: string;
  slotLevel: number;
  /** Cast as a ritual: no slot spent (spell must be a ritual). */
  ritual: boolean;
  visibility: Extract<RollVisibility, "public" | "dm_only">;
}

export interface CastResult {
  characterId: string;
  version: number;
  spell: { name: string; level: number; srdId: string; concentration: boolean };
  slotLevel: number;
  slotSpent: boolean;
  /** The sheet changed (slot spent or concentration started). */
  changed: boolean;
  plan: SpellCastPlan | null;
  saveDc: number | null;
  save: string | null;
  area: SrdSpell["area"] | null;
  rolls: RollDto[];
}

/**
 * Things a character does at the table that change its sheet and post to the log:
 * casting a spell (spends a slot, rolls on the server) and handing an item to
 * another character. Both lock the sheet rows so concurrent edits can't lose data.
 */
export class CharacterActions {
  constructor(
    private readonly db: Db,
    private readonly chat: ChatService,
  ) {}

  /** The member's own character in this campaign, or (for the DM) a campaign NPC. */
  private async actingCharacter(m: Membership, characterId: string): Promise<CharacterRow> {
    const [c] = await this.db.select().from(characters).where(and(eq(characters.id, characterId), isNull(characters.deletedAt)));
    if (!c) throw notFound("Character");
    if (characterId === m.member.activeCharacterId && c.ownerId === m.member.userId) return c;
    if (c.campaignId === m.campaign.id && m.caps.has("npc.manage")) return c;
    throw forbidden("You can only act as your own character");
  }

  async cast(m: Membership, characterId: string, input: CastInput): Promise<CastResult> {
    await this.actingCharacter(m, characterId);
    const ruleset = getBuiltinRuleset(m.campaign.rulesetId);
    if (!ruleset) throw badRequest("Unknown ruleset");

    // Spend the slot under a row lock.
    const { row, entry, slotLevel, slotSpent, dropped } = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(characters).where(eq(characters.id, characterId)).for("update");
      const data = structuredClone(row!.data) as CharacterData;
      const entry = data.spellcasting.spells.find((s) => s.id === input.spellId);
      if (!entry) throw badRequest("That spell isn't on the character sheet");
      let slotLevel = entry.level;
      let slotSpent = false;
      if (entry.level > 0 && !input.ritual) {
        slotLevel = input.slotLevel;
        if (slotLevel < entry.level || slotLevel > 9) throw badRequest(`${entry.name} needs a slot of level ${entry.level} or higher`);
        const slot = data.spellcasting.slots[slotLevel - 1]!;
        if (slot.used >= slot.max) throw conflict(`No ${ORDINAL[slotLevel]}-level spell slots left`);
        slot.used += 1;
        slotSpent = true;
      } else if (input.ritual && !entry.ritual) {
        throw badRequest(`${entry.name} can't be cast as a ritual`);
      }
      // Casting a concentration spell ends any earlier concentration.
      let dropped: string | null = null;
      if (entry.concentration) {
        dropped = data.concentration && data.concentration.spell !== entry.name ? data.concentration.spell : null;
        data.concentration = { spell: entry.name, spellId: entry.id, since: new Date().toISOString() };
      }
      if (!slotSpent && !entry.concentration) return { row: row!, entry, slotLevel, slotSpent, dropped };
      const [updated] = await tx
        .update(characters)
        .set({ data, version: row!.version + 1, updatedAt: new Date() })
        .where(eq(characters.id, characterId))
        .returning();
      return { row: updated!, entry, slotLevel, slotSpent, dropped };
    });

    const derived = deriveCharacter(row.data, ruleset);
    const casting = row.data.spellcasting.ability;
    const mod = casting === "none" ? 0 : abilityModifier(row.data.abilities[casting]);
    const srd = entry.srdId ? getSrdSpell(entry.srdId) : undefined;
    const plan = srd ? planCast(srd, slotLevel, derived.totalLevel, mod) : null;
    const saveDc = srd?.save ? (derived.spellSaveDc?.value ?? null) : null;
    const attackBonus = derived.spellAttackBonus?.value ?? 0;

    // Announce the cast, then roll.
    const levelText = entry.level === 0 ? "" : input.ritual ? " as a ritual" : ` at ${ORDINAL[slotLevel]} level`;
    const saveText = srd?.save && saveDc !== null ? ` — DC ${saveDc} ${ABILITY_NAME[srd.save]} save${srd.halfOnSave ? " (half on success)" : ""}` : "";
    const areaText = srd?.area ? ` — ${srd.area.sizeFt}-ft ${srd.area.shape}` : "";
    // A hidden cast (DM-only rolls) is announced to the DM only, so players learn nothing from the log.
    const dmOnly = input.visibility === "dm_only";
    if (dropped) await this.chat.system(m.campaign.id, `${row.name} stops concentrating on ${dropped}`, { dmOnly });
    await this.chat.system(m.campaign.id, `${row.name} casts ${entry.name}${levelText}${saveText}${areaText}${entry.concentration ? " (concentration)" : ""}`, { dmOnly });

    const rolls: RollDto[] = [];
    const roll = async (formula: string, label: string, rollType: string) => {
      const dto = await this.chat.roll(m, { formula, mode: "normal", visibility: input.visibility, recipientIds: [], label, rollType, characterId: row.id });
      const view = rollForViewer(dto, viewerFor(m.member.userId, m.role));
      if (view) rolls.push(view);
    };
    if (plan && srd) {
      for (let b = 1; b <= plan.beams; b++) {
        const tag = plan.beams > 1 ? ` ${b}/${plan.beams}` : "";
        if (srd.attack) await roll(`1d20${attackBonus >= 0 ? "+" : ""}${attackBonus}`, `${srd.name}${tag} — spell attack`, "attack");
        for (const d of plan.damage) await roll(d.formula, `${srd.name}${tag} — ${d.type} damage`, "damage");
      }
      if (plan.heal) await roll(plan.heal, `${srd.name} — healing`, "healing");
    }

    return {
      characterId: row.id,
      version: row.version,
      spell: { name: entry.name, level: entry.level, srdId: entry.srdId, concentration: entry.concentration },
      slotLevel,
      slotSpent,
      changed: slotSpent || entry.concentration,
      plan,
      saveDc,
      save: srd?.save ?? null,
      area: srd?.area ?? null,
      rolls,
    };
  }

  /**
   * Ends concentration: the character's controller, or the DM for any character at the table
   * (e.g. after a failed save the DM rolled).
   */
  async endConcentration(m: Membership, characterId: string): Promise<{ id: string; name: string; spell: string } | null> {
    let allowed = false;
    try {
      await this.actingCharacter(m, characterId);
      allowed = true;
    } catch {
      allowed = m.caps.has("token.manageAll") && (await this.recipients(m)).some((c) => c.id === characterId);
    }
    if (!allowed) throw forbidden("You can't change this character");
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(characters).where(eq(characters.id, characterId)).for("update");
      if (!row) throw notFound("Character");
      const data = structuredClone(row.data) as CharacterData;
      const spell = data.concentration?.spell;
      if (!spell) return null;
      data.concentration = null;
      await tx.update(characters).set({ data, version: row.version + 1, updatedAt: new Date() }).where(eq(characters.id, row.id));
      return { id: row.id, name: row.name, spell };
    });
  }

  /** Characters an item can be handed to: everyone's active character, plus NPCs for the DM. */
  async recipients(m: Membership): Promise<Array<{ id: string; name: string }>> {
    const pcs = await this.db
      .select({ id: characters.id, name: characters.name })
      .from(campaignMembers)
      .innerJoin(characters, eq(characters.id, campaignMembers.activeCharacterId))
      .where(and(eq(campaignMembers.campaignId, m.campaign.id), isNull(characters.deletedAt)));
    if (!m.caps.has("npc.manage")) return pcs;
    const npcs = await this.db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(and(eq(characters.campaignId, m.campaign.id), isNull(characters.deletedAt)));
    return [...pcs, ...npcs];
  }

  /**
   * Moves `quantity` of an item to another character. Stacks merge on the receiving
   * sheet when name and category match; equipped state doesn't travel.
   */
  async give(m: Membership, fromId: string, input: { itemId: string; quantity: number; toCharacterId: string }) {
    if (fromId === input.toCharacterId) throw badRequest("Pick a different character");
    await this.actingCharacter(m, fromId);
    const allowed = await this.recipients(m);
    if (!allowed.some((c) => c.id === input.toCharacterId)) throw badRequest("You can only give items to characters at this table");

    return this.db.transaction(async (tx) => {
      // Lock both sheets in a fixed order to avoid deadlocks.
      const rows = await tx
        .select()
        .from(characters)
        .where(inArray(characters.id, [fromId, input.toCharacterId].sort()))
        .orderBy(characters.id)
        .for("update");
      const from = rows.find((r) => r.id === fromId);
      const to = rows.find((r) => r.id === input.toCharacterId);
      if (!from || !to) throw notFound("Character");
      const fromData = structuredClone(from.data) as CharacterData;
      const toData = structuredClone(to.data) as CharacterData;
      const idx = fromData.inventory.findIndex((i) => i.id === input.itemId);
      const item = fromData.inventory[idx];
      if (!item) throw badRequest("That item isn't in the inventory any more");
      if (input.quantity > item.quantity) throw badRequest(`Only ${item.quantity} to give`);
      const qty = input.quantity;
      if (qty === item.quantity) fromData.inventory.splice(idx, 1);
      else item.quantity -= qty;
      const same = toData.inventory.find((i) => i.name.toLowerCase() === item.name.toLowerCase() && i.category === item.category);
      if (same) same.quantity += qty;
      else {
        if (toData.inventory.length >= 500) throw badRequest(`${to.name}'s inventory is full`);
        toData.inventory.push({ ...item, id: randomUUID().slice(0, 12), quantity: qty, equipped: false });
      }
      const now = new Date();
      await tx.update(characters).set({ data: fromData, version: from.version + 1, updatedAt: now }).where(eq(characters.id, from.id));
      await tx.update(characters).set({ data: toData, version: to.version + 1, updatedAt: now }).where(eq(characters.id, to.id));
      return { from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name }, item: item.name, quantity: qty };
    });
  }
}
