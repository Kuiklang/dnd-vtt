/**
 * Initiative order and turn/round bookkeeping. Pure state transitions so the
 * server can validate and persist them and tests can pin down edge cases
 * (skipping defeated combatants, wrapping rounds, undoing a turn change).
 */

export interface CombatantOrderInfo {
  id: string;
  name: string;
  initiative: number | null;
  /** Tie-breaker: higher initiative bonus (DEX) goes first. */
  initiativeBonus: number;
  /** Manual DM ordering within ties / after drag reorder (lower first). */
  sortOrder: number;
  defeated: boolean;
}

export interface TurnState {
  round: number;
  /** Index into the ordered list. */
  turnIndex: number;
}

/** Highest initiative first; unrolled combatants go last; ties by bonus, then DM order, then name. */
export function orderCombatants<T extends CombatantOrderInfo>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ai = a.initiative ?? -Infinity;
    const bi = b.initiative ?? -Infinity;
    if (ai !== bi) return bi - ai;
    if (a.initiativeBonus !== b.initiativeBonus) return b.initiativeBonus - a.initiativeBonus;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Advances to the next combatant that isn't defeated, wrapping into a new round.
 * Returns the same state if nobody can act.
 */
export function nextTurn(state: TurnState, ordered: CombatantOrderInfo[]): TurnState {
  const n = ordered.length;
  if (n === 0 || ordered.every((c) => c.defeated)) return state;
  let { round, turnIndex } = state;
  for (let step = 0; step < n; step++) {
    turnIndex++;
    if (turnIndex >= n) {
      turnIndex = 0;
      round++;
    }
    if (!ordered[turnIndex]!.defeated) return { round, turnIndex };
  }
  return state;
}

/** Steps back one turn (DM undo of a turn change), never before round 1 / first turn. */
export function previousTurn(state: TurnState, ordered: CombatantOrderInfo[]): TurnState {
  const n = ordered.length;
  if (n === 0) return state;
  let { round, turnIndex } = state;
  for (let step = 0; step < n; step++) {
    turnIndex--;
    if (turnIndex < 0) {
      if (round <= 1) return state;
      turnIndex = n - 1;
      round--;
    }
    if (!ordered[turnIndex]!.defeated) return { round, turnIndex };
  }
  return state;
}

/** First non-defeated combatant, used when combat starts or the order changes. */
export function firstTurn(ordered: CombatantOrderInfo[]): TurnState {
  const i = ordered.findIndex((c) => !c.defeated);
  return { round: 1, turnIndex: Math.max(0, i) };
}

export interface TimedCondition {
  id: string;
  durationRounds: number | null;
}

/**
 * Conditions tick down at the end of the affected creature's turn; ones reaching 0 expire.
 * Indefinite conditions (null) are untouched.
 */
export function tickConditions<T extends TimedCondition>(conditions: T[]): { kept: T[]; expired: T[] } {
  const kept: T[] = [];
  const expired: T[] = [];
  for (const c of conditions) {
    if (c.durationRounds === null) kept.push(c);
    else if (c.durationRounds <= 1) expired.push(c);
    else kept.push({ ...c, durationRounds: c.durationRounds - 1 });
  }
  return { kept, expired };
}

export interface ActionEconomy {
  action: boolean;
  bonusAction: boolean;
  reaction: boolean;
  freeInteraction: boolean;
  /** Movement used this turn, in game units. */
  movementUsed: number;
}

export const FRESH_ACTIONS: ActionEconomy = { action: false, bonusAction: false, reaction: false, freeInteraction: false, movementUsed: 0 };
