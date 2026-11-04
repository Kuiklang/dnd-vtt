import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  FRESH_ACTIONS,
  NO_DEFENSES,
  applyHp,
  deriveCharacter,
  firstTurn,
  getBuiltinRuleset,
  nextTurn,
  orderCombatants,
  previousTurn,
  tickConditions,
  type ActionEconomy,
  type HpAction,
  type TokenCondition,
  type TokenViewer,
} from "@vtt/rules";
import type { Db } from "../db/client.js";
import { characters, combatants, combats, tokens, type CombatRow, type CombatantRow, type TokenRow, type TokenStats } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { Membership } from "../campaigns/service.js";
import type { ChatService } from "../chat/service.js";
import { redactToken, toTokenDto, viewerOf, type LinkedCharacter, type TokenDto, type TokenVitals } from "../scenes/service.js";

export const MAX_COMBATANTS = 100;

export interface CombatantDto {
  id: string;
  tokenId: string | null;
  characterId: string | null;
  name: string;
  initiative: number | null;
  initiativeBonus: number;
  hidden: boolean;
  defeated: boolean;
  actions: ActionEconomy;
  ownerIds: string[];
  vitals: TokenVitals | null;
  vitalsHidden: boolean;
}

export interface CombatDto {
  id: string;
  sceneId: string | null;
  round: number;
  turnIndex: number;
  activeCombatantId: string | null;
  version: number;
  /** In initiative order; hidden combatants are omitted for players. */
  combatants: CombatantDto[];
}

/** Things that changed as a side effect, so the realtime layer can re-broadcast them. */
export interface CombatEffects {
  tokenIds: Set<string>;
  characterIds: Set<string>;
}

const effects = (): CombatEffects => ({ tokenIds: new Set(), characterIds: new Set() });

interface Loaded {
  combat: CombatRow;
  rows: Array<{ c: CombatantRow; token: TokenRow | null; character: LinkedCharacter | null }>;
}

export class CombatService {
  constructor(
    private readonly db: Db,
    private readonly chat: ChatService,
  ) {}

  private requireGM(m: Membership) {
    if (!m.caps.has("combat.manage")) throw forbidden("Only the DM can manage combat");
  }

  private async activeCombat(campaignId: string): Promise<CombatRow | null> {
    const [c] = await this.db
      .select()
      .from(combats)
      .where(and(eq(combats.campaignId, campaignId), eq(combats.status, "active")))
      .limit(1);
    return c ?? null;
  }

  private async load(campaignId: string): Promise<Loaded | null> {
    const combat = await this.activeCombat(campaignId);
    if (!combat) return null;
    const rows = await this.db
      .select({ c: combatants, token: tokens, data: characters.data, kind: characters.kind, deletedAt: characters.deletedAt })
      .from(combatants)
      .leftJoin(tokens, eq(tokens.id, combatants.tokenId))
      .leftJoin(characters, eq(characters.id, combatants.characterId))
      .where(eq(combatants.combatId, combat.id))
      .orderBy(asc(combatants.createdAt));
    return {
      combat,
      rows: rows.map((r) => ({
        c: r.c,
        token: r.token,
        character: r.data && r.kind && !r.deletedAt ? { data: r.data, kind: r.kind } : null,
      })),
    };
  }

  private ordered(l: Loaded) {
    return orderCombatants(l.rows.map((r) => ({ ...r, ...r.c })));
  }

  private async requireActive(m: Membership): Promise<Loaded> {
    const l = await this.load(m.campaign.id);
    if (!l) throw badRequest("No combat is running");
    return l;
  }

  /** The combat as one viewer may see it. */
  async stateFor(campaignId: string, viewer: TokenViewer): Promise<CombatDto | null> {
    const l = await this.load(campaignId);
    return l ? this.toDto(l, viewer) : null;
  }

  async state(m: Membership): Promise<CombatDto | null> {
    return this.stateFor(m.campaign.id, viewerOf(m));
  }

  private toDto(l: Loaded, viewer: TokenViewer): CombatDto {
    const ordered = this.ordered(l);
    const list = ordered
      .filter((r) => viewer.isGameMaster || !r.c.hidden)
      .map((r): CombatantDto => {
        let vitals: TokenVitals | null = null;
        let vitalsHidden = false;
        if (r.token) {
          const t = redactToken(toTokenDto(r.token, r.character), viewer);
          vitals = t.vitals;
          vitalsHidden = t.vitalsHidden;
        } else if (r.character) {
          // Combatant without a token (e.g. a PC who isn't on the map): party HP is visible to the table.
          const t = r.character;
          vitals = { hp: t.data.hp, ac: t.data.armorClass, conditions: t.data.conditions, defenses: t.data.defenses ?? NO_DEFENSES, source: "character" };
          if (!viewer.isGameMaster && t.kind !== "pc") {
            vitals = null;
            vitalsHidden = true;
          }
        }
        return {
          id: r.c.id,
          tokenId: r.c.tokenId,
          characterId: r.c.characterId,
          name: r.c.name,
          initiative: r.c.initiative,
          initiativeBonus: r.c.initiativeBonus,
          hidden: r.c.hidden,
          defeated: r.c.defeated,
          actions: r.c.actions,
          ownerIds: r.c.ownerIds,
          vitals,
          vitalsHidden,
        };
      });
    return {
      id: l.combat.id,
      sceneId: l.combat.sceneId,
      round: l.combat.round,
      turnIndex: l.combat.turnIndex,
      activeCombatantId: l.combat.activeCombatantId,
      version: l.combat.version,
      combatants: list,
    };
  }

  // ---- Lifecycle -------------------------------------------------------------

  /** Starts combat with the given tokens (default: every creature token on the scene). */
  async start(m: Membership, sceneId: string, tokenIds?: string[]): Promise<void> {
    this.requireGM(m);
    if (await this.activeCombat(m.campaign.id)) throw conflict("A combat is already running. End it first.");
    const sceneTokens = await this.db
      .select({ token: tokens, data: characters.data, kind: characters.kind })
      .from(tokens)
      .leftJoin(characters, eq(characters.id, tokens.characterId))
      .where(and(eq(tokens.sceneId, sceneId), eq(tokens.campaignId, m.campaign.id)));
    const chosen = tokenIds
      ? sceneTokens.filter((r) => tokenIds.includes(r.token.id))
      : sceneTokens.filter((r) => r.token.layer === "tokens" || r.token.layer === "dm");
    if (tokenIds && chosen.length !== new Set(tokenIds).size) throw badRequest("Some tokens aren't on this map");
    if (chosen.length > MAX_COMBATANTS) throw badRequest(`At most ${MAX_COMBATANTS} combatants`);
    try {
      await this.db.transaction(async (tx) => {
        const [combat] = await tx.insert(combats).values({ campaignId: m.campaign.id, sceneId, startedBy: m.member.userId }).returning();
        if (chosen.length) {
          await tx.insert(combatants).values(
            chosen.map((r, i) => this.combatantFromToken(combat!.id, r.token, r.data && r.kind ? { data: r.data, kind: r.kind } : null, m.campaign.rulesetId, i)),
          );
        }
      });
    } catch (e) {
      // Unique partial index: someone started a combat at the same time.
      if ((e as { code?: string }).code === "23505") throw conflict("A combat is already running. End it first.");
      throw e;
    }
  }

  private combatantFromToken(combatId: string, t: TokenRow, character: LinkedCharacter | null, rulesetId: string, sortOrder: number) {
    const ruleset = getBuiltinRuleset(rulesetId);
    const bonus = character && ruleset ? deriveCharacter(character.data, ruleset).initiative.value : (t.stats?.initiativeBonus ?? 0);
    return {
      combatId,
      tokenId: t.id,
      characterId: t.characterId,
      name: t.name,
      initiativeBonus: bonus,
      sortOrder,
      hidden: t.hidden || t.layer === "dm",
      actions: FRESH_ACTIONS,
      ownerIds: t.ownerIds,
    };
  }

  async end(m: Membership): Promise<void> {
    this.requireGM(m);
    const c = await this.activeCombat(m.campaign.id);
    if (!c) throw badRequest("No combat is running");
    await this.db.update(combats).set({ status: "ended", endedAt: new Date() }).where(eq(combats.id, c.id));
  }

  async addTokens(m: Membership, tokenIds: string[]): Promise<void> {
    this.requireGM(m);
    const l = await this.requireActive(m);
    const existing = new Set(l.rows.map((r) => r.c.tokenId));
    const rows = await this.db
      .select({ token: tokens, data: characters.data, kind: characters.kind })
      .from(tokens)
      .leftJoin(characters, eq(characters.id, tokens.characterId))
      .where(and(inArray(tokens.id, tokenIds), eq(tokens.campaignId, m.campaign.id)));
    const fresh = rows.filter((r) => !existing.has(r.token.id));
    if (l.rows.length + fresh.length > MAX_COMBATANTS) throw badRequest(`At most ${MAX_COMBATANTS} combatants`);
    if (!fresh.length) return;
    const base = l.rows.length;
    await this.db.insert(combatants).values(
      fresh.map((r, i) => this.combatantFromToken(l.combat.id, r.token, r.data && r.kind ? { data: r.data, kind: r.kind } : null, m.campaign.rulesetId, base + i)),
    );
    await this.touch(l.combat.id);
  }

  /** A combatant with no token (summon, off-map threat). */
  async addCustom(m: Membership, input: { name: string; initiativeBonus: number; hidden: boolean }): Promise<void> {
    this.requireGM(m);
    const l = await this.requireActive(m);
    if (l.rows.length >= MAX_COMBATANTS) throw badRequest(`At most ${MAX_COMBATANTS} combatants`);
    await this.db.insert(combatants).values({
      combatId: l.combat.id,
      name: input.name,
      initiativeBonus: input.initiativeBonus,
      hidden: input.hidden,
      sortOrder: l.rows.length,
      actions: FRESH_ACTIONS,
    });
    await this.touch(l.combat.id);
  }

  async remove(m: Membership, combatantId: string): Promise<void> {
    this.requireGM(m);
    const l = await this.requireActive(m);
    const ordered = this.ordered(l);
    const target = ordered.find((r) => r.c.id === combatantId);
    if (!target) throw notFound("Combatant");
    await this.db.delete(combatants).where(eq(combatants.id, combatantId));
    if (l.combat.activeCombatantId === combatantId) {
      // Hand the turn to whoever was next.
      const rest = ordered.filter((r) => r.c.id !== combatantId);
      const idx = Math.min(ordered.indexOf(target), rest.length - 1);
      const next = rest.slice(idx).find((r) => !r.c.defeated) ?? rest.find((r) => !r.c.defeated);
      await this.setTurn(l.combat.id, l.combat.round, next ? rest.indexOf(next) : 0, next?.c.id ?? null);
    } else {
      await this.syncTurnIndex(l.combat.id);
    }
  }

  // ---- Initiative ---------------------------------------------------------------

  /**
   * Rolls initiative on the server (d20 + bonus) and posts each roll to the dice log.
   * GMs may roll for anyone ("all", "npcs" or ids); players only for combatants they own
   * that haven't rolled yet.
   */
  async rollInitiative(m: Membership, which: "all" | "npcs" | string[]): Promise<void> {
    const l = await this.requireActive(m);
    const isGM = m.caps.has("combat.manage");
    let targets = l.rows;
    if (which === "npcs") targets = targets.filter((r) => r.character?.kind !== "pc" && r.c.ownerIds.length === 0);
    else if (Array.isArray(which)) targets = targets.filter((r) => which.includes(r.c.id));
    if (!isGM) {
      if (!Array.isArray(which)) throw forbidden("Only the DM can roll for everyone");
      if (targets.some((r) => !r.c.ownerIds.includes(m.member.userId))) throw forbidden("You can only roll initiative for your own character");
      if (targets.some((r) => r.c.initiative !== null)) throw badRequest("Initiative already rolled. Ask the DM to change it.");
    }
    if (!targets.length) throw badRequest("Nobody to roll for");
    for (const r of targets) {
      const bonus = r.c.initiativeBonus;
      const formula = bonus === 0 ? "1d20" : `1d20${bonus > 0 ? "+" : ""}${bonus}`;
      const ownsActive = r.c.characterId && r.c.characterId === m.member.activeCharacterId;
      const dto = await this.chat.roll(m, {
        formula,
        mode: "normal",
        // Hidden combatants' rolls stay with the DM.
        visibility: r.c.hidden && isGM ? "dm_only" : "public",
        recipientIds: [],
        label: `${r.c.name} — Initiative`,
        rollType: "initiative",
        characterId: ownsActive ? r.c.characterId : null,
      });
      await this.db.update(combatants).set({ initiative: dto.total }).where(eq(combatants.id, r.c.id));
    }
    await this.syncTurnIndex(l.combat.id);
  }

  async setInitiative(m: Membership, combatantId: string, value: number | null): Promise<void> {
    this.requireGM(m);
    const l = await this.requireActive(m);
    if (!l.rows.some((r) => r.c.id === combatantId)) throw notFound("Combatant");
    await this.db.update(combatants).set({ initiative: value }).where(eq(combatants.id, combatantId));
    await this.syncTurnIndex(l.combat.id);
  }

  // ---- Turns ----------------------------------------------------------------------

  /** Ends the current turn. GMs always; players when it's their combatant's turn. */
  async next(m: Membership, expectedVersion?: number): Promise<CombatEffects> {
    const l = await this.requireActive(m);
    if (expectedVersion !== undefined && expectedVersion !== l.combat.version) throw conflict("The turn already changed");
    const ordered = this.ordered(l);
    const current = ordered.find((r) => r.c.id === l.combat.activeCombatantId) ?? null;
    if (!m.caps.has("combat.manage")) {
      if (!current || !current.c.ownerIds.includes(m.member.userId)) throw forbidden("It isn't your turn");
    }
    const fx = effects();
    if (current) await this.tickEndOfTurn(current, fx);
    const atStart = !l.combat.activeCombatantId;
    const state = atStart ? firstTurn(ordered.map((r) => r.c)) : nextTurn({ round: l.combat.round, turnIndex: l.combat.turnIndex }, ordered.map((r) => r.c));
    const nextC = ordered[state.turnIndex];
    if (nextC) await this.db.update(combatants).set({ actions: FRESH_ACTIONS }).where(eq(combatants.id, nextC.c.id));
    await this.setTurn(l.combat.id, state.round, state.turnIndex, nextC?.c.id ?? null);
    return fx;
  }

  /** DM undo of a turn change (conditions that expired are not restored). */
  async previous(m: Membership): Promise<void> {
    this.requireGM(m);
    const l = await this.requireActive(m);
    const ordered = this.ordered(l);
    const state = previousTurn({ round: l.combat.round, turnIndex: l.combat.turnIndex }, ordered.map((r) => r.c));
    await this.setTurn(l.combat.id, state.round, state.turnIndex, ordered[state.turnIndex]?.c.id ?? null);
  }

  private async tickEndOfTurn(r: Loaded["rows"][number], fx: CombatEffects) {
    if (r.c.characterId && r.character) {
      const { kept, expired } = tickConditions(r.character.data.conditions);
      if (expired.length || kept.some((k, i) => k.durationRounds !== r.character!.data.conditions[i]?.durationRounds)) {
        await this.writeCharacter(r.c.characterId, (d) => ({ ...d, conditions: kept }));
        fx.characterIds.add(r.c.characterId);
      }
    } else if (r.token?.stats) {
      const { kept } = tickConditions(r.token.stats.conditions);
      await this.writeTokenStats(r.token.id, { ...r.token.stats, conditions: kept });
      fx.tokenIds.add(r.token.id);
    }
  }

  private async setTurn(combatId: string, round: number, turnIndex: number, activeCombatantId: string | null) {
    await this.db
      .update(combats)
      .set({ round, turnIndex, activeCombatantId, version: sql`${combats.version} + 1` })
      .where(eq(combats.id, combatId));
  }

  private async touch(combatId: string) {
    await this.db.update(combats).set({ version: sql`${combats.version} + 1` }).where(eq(combats.id, combatId));
  }

  /** After the order changes, keep the turn on the same combatant. */
  private async syncTurnIndex(combatId: string) {
    const [combat] = await this.db.select().from(combats).where(eq(combats.id, combatId));
    if (!combat) return;
    const l = await this.load(combat.campaignId);
    if (!l) return;
    const ordered = this.ordered(l);
    const idx = combat.activeCombatantId ? ordered.findIndex((r) => r.c.id === combat.activeCombatantId) : 0;
    await this.setTurn(combatId, combat.round, Math.max(0, idx), combat.activeCombatantId);
  }

  async updateCombatant(
    m: Membership,
    combatantId: string,
    patch: { hidden?: boolean; defeated?: boolean; name?: string; actions?: Partial<ActionEconomy> },
  ): Promise<void> {
    const l = await this.requireActive(m);
    const r = l.rows.find((x) => x.c.id === combatantId);
    if (!r) throw notFound("Combatant");
    const isGM = m.caps.has("combat.manage");
    const gmOnly = patch.hidden !== undefined || patch.defeated !== undefined || patch.name !== undefined;
    if (!isGM && (gmOnly || !r.c.ownerIds.includes(m.member.userId))) throw forbidden("Only the DM can change that");
    const values: Partial<typeof combatants.$inferInsert> = {};
    if (patch.hidden !== undefined) values.hidden = patch.hidden;
    if (patch.defeated !== undefined) values.defeated = patch.defeated;
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.actions) values.actions = { ...r.c.actions, ...patch.actions };
    await this.db.update(combatants).set(values).where(eq(combatants.id, combatantId));
    await this.touch(l.combat.id);
  }

  // ---- HP and conditions (tokens, in or out of combat) ---------------------------------

  private async tokenWithCharacter(m: Membership, tokenId: string) {
    const [r] = await this.db
      .select({ token: tokens, data: characters.data, kind: characters.kind, deletedAt: characters.deletedAt })
      .from(tokens)
      .leftJoin(characters, eq(characters.id, tokens.characterId))
      .where(and(eq(tokens.id, tokenId), eq(tokens.campaignId, m.campaign.id)));
    if (!r) throw notFound("Token");
    const character = r.data && r.kind && !r.deletedAt ? { data: r.data, kind: r.kind } : null;
    const isGM = m.caps.has("token.manageAll");
    // Owners may adjust their own token's HP/conditions (players' quick actions); everything else is DM-only.
    if (!isGM && !r.token.ownerIds.includes(m.member.userId)) throw forbidden("You can only change your own token");
    return { token: r.token, character, isGM };
  }

  /**
   * Applies damage/healing/temp HP (rules engine) or a DM "set" override.
   * HP lives on the linked character sheet when there is one, else on the token.
   */
  async applyHp(m: Membership, tokenId: string, action: HpAction): Promise<{ token: TokenDto; notes: string[]; effective: number; fx: CombatEffects }> {
    const { token, character, isGM } = await this.tokenWithCharacter(m, tokenId);
    if (action.kind === "set" && !isGM) throw forbidden("Only the DM can set HP directly");
    const fx = effects();
    fx.tokenIds.add(token.id);
    const vitalsHp = character ? character.data.hp : token.stats?.hp;
    if (!vitalsHp && action.kind !== "set") throw badRequest("This token doesn't track HP yet. Set its max HP first.");
    const defenses = character?.data.defenses ?? token.stats?.defenses ?? NO_DEFENSES;
    const result = applyHp(vitalsHp ?? { current: 0, max: 0, temp: 0 }, action, defenses);
    if (character && token.characterId) {
      await this.writeCharacter(token.characterId, (d) => ({ ...d, hp: result.hp }));
      fx.characterIds.add(token.characterId);
    } else {
      const stats: TokenStats = token.stats ?? { hp: result.hp, ac: null, initiativeBonus: 0, conditions: [], defenses: NO_DEFENSES };
      await this.writeTokenStats(token.id, { ...stats, hp: result.hp });
    }
    // Monsters and NPCs dropping to 0 are marked defeated in the running combat; PCs make death saves instead.
    if (result.downed && character?.kind !== "pc") {
      const combat = await this.activeCombat(m.campaign.id);
      if (combat) await this.db.update(combatants).set({ defeated: true }).where(and(eq(combatants.combatId, combat.id), eq(combatants.tokenId, token.id)));
    }
    const dto = await this.tokenDtoFor(token.id, m);
    return { token: dto, notes: result.notes, effective: result.effectiveAmount, fx };
  }

  async setConditions(m: Membership, tokenId: string, conditions: TokenCondition[]): Promise<{ token: TokenDto; fx: CombatEffects }> {
    const { token, character } = await this.tokenWithCharacter(m, tokenId);
    const ruleset = getBuiltinRuleset(m.campaign.rulesetId);
    const known = new Set(ruleset?.conditions.map((c) => c.id) ?? []);
    for (const c of conditions) if (known.size && !known.has(c.id)) throw badRequest(`Unknown condition '${c.id}' for this ruleset`);
    const fx = effects();
    fx.tokenIds.add(token.id);
    const clean = conditions.map((c) => ({ id: c.id, ...(c.level ? { level: c.level } : {}), source: c.source ?? "", durationRounds: c.durationRounds }));
    if (character && token.characterId) {
      await this.writeCharacter(token.characterId, (d) => ({ ...d, conditions: clean }));
      fx.characterIds.add(token.characterId);
    } else {
      const stats: TokenStats = token.stats ?? { hp: { current: 0, max: 0, temp: 0 }, ac: null, initiativeBonus: 0, conditions: [], defenses: NO_DEFENSES };
      await this.writeTokenStats(token.id, { ...stats, conditions: clean });
    }
    return { token: await this.tokenDtoFor(token.id, m), fx };
  }

  private async tokenDtoFor(tokenId: string, m: Membership): Promise<TokenDto> {
    const [r] = await this.db
      .select({ token: tokens, data: characters.data, kind: characters.kind, deletedAt: characters.deletedAt })
      .from(tokens)
      .leftJoin(characters, eq(characters.id, tokens.characterId))
      .where(eq(tokens.id, tokenId));
    return redactToken(toTokenDto(r!.token, r!.data && r!.kind && !r!.deletedAt ? { data: r!.data, kind: r!.kind } : null), viewerOf(m));
  }

  private async writeCharacter(characterId: string, fn: (d: LinkedCharacter["data"]) => LinkedCharacter["data"]) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select({ data: characters.data }).from(characters).where(eq(characters.id, characterId)).for("update");
      if (!row) return;
      await tx
        .update(characters)
        .set({ data: fn(row.data), version: sql`${characters.version} + 1`, updatedAt: new Date() })
        .where(eq(characters.id, characterId));
    });
  }

  private async writeTokenStats(tokenId: string, stats: TokenStats) {
    await this.db.update(tokens).set({ stats, version: sql`${tokens.version} + 1`, updatedAt: new Date() }).where(eq(tokens.id, tokenId));
  }
}
