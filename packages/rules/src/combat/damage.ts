/**
 * Damage and healing maths (5e). Pure functions: the server applies them and
 * the DM can always override the result by setting HP directly.
 */
import type { Defenses } from "../character/schema.js";

export interface HpState {
  current: number;
  max: number;
  temp: number;
}

export type HpAction =
  | { kind: "damage"; amount: number; damageType?: string | null }
  | { kind: "heal"; amount: number }
  | { kind: "temp"; amount: number }
  /** DM override: set current (and optionally max/temp) directly. */
  | { kind: "set"; current: number; max?: number; temp?: number };

export interface HpResult {
  hp: HpState;
  /** Damage actually dealt after defenses (before temp HP absorption). */
  effectiveAmount: number;
  absorbedByTemp: number;
  /** Human-readable modifiers that applied, e.g. ["resistant to fire"]. */
  notes: string[];
  /** Dropped to 0 HP by this change. */
  downed: boolean;
}

export const NO_DEFENSES: Defenses = { resistances: [], vulnerabilities: [], immunities: [] };

/**
 * Applies defenses to a damage amount: immunity → 0; resistance halves (rounded down);
 * vulnerability doubles. Resistance and vulnerability to the same type both apply
 * (halve, then double), matching the 5e order of operations.
 */
export function modifyDamage(amount: number, damageType: string | null | undefined, defenses: Defenses): { amount: number; notes: string[] } {
  let value = Math.max(0, Math.floor(amount));
  const notes: string[] = [];
  if (!damageType) return { amount: value, notes };
  const t = damageType.toLowerCase();
  if (defenses.immunities.some((d) => d.toLowerCase() === t)) return { amount: 0, notes: [`immune to ${t}`] };
  if (defenses.resistances.some((d) => d.toLowerCase() === t)) {
    value = Math.floor(value / 2);
    notes.push(`resistant to ${t}`);
  }
  if (defenses.vulnerabilities.some((d) => d.toLowerCase() === t)) {
    value *= 2;
    notes.push(`vulnerable to ${t}`);
  }
  return { amount: value, notes };
}

const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

export function applyHp(hp: HpState, action: HpAction, defenses: Defenses = NO_DEFENSES): HpResult {
  const before = hp.current;
  switch (action.kind) {
    case "damage": {
      const { amount, notes } = modifyDamage(action.amount, action.damageType, defenses);
      const absorbedByTemp = Math.min(hp.temp, amount);
      const current = Math.max(0, hp.current - (amount - absorbedByTemp));
      return { hp: { ...hp, temp: hp.temp - absorbedByTemp, current }, effectiveAmount: amount, absorbedByTemp, notes, downed: before > 0 && current === 0 };
    }
    case "heal": {
      const amount = Math.max(0, Math.floor(action.amount));
      // Healing starts from 0 even if HP was tracked below zero.
      return { hp: { ...hp, current: Math.min(hp.max, Math.max(0, hp.current) + amount) }, effectiveAmount: amount, absorbedByTemp: 0, notes: [], downed: false };
    }
    case "temp": {
      const amount = Math.max(0, Math.floor(action.amount));
      const notes = amount <= hp.temp && hp.temp > 0 ? ["temporary HP don't stack; kept the higher value"] : [];
      return { hp: { ...hp, temp: Math.max(hp.temp, amount) }, effectiveAmount: amount, absorbedByTemp: 0, notes, downed: false };
    }
    case "set": {
      const max = clampInt(action.max ?? hp.max, 0, 10000);
      const current = clampInt(action.current, -10000, max);
      const temp = clampInt(action.temp ?? hp.temp, 0, 10000);
      return { hp: { current, max, temp }, effectiveAmount: 0, absorbedByTemp: 0, notes: ["set by DM"], downed: before > 0 && current <= 0 };
    }
  }
}

/**
 * DC of the Constitution save to keep concentrating after taking damage (SRD):
 * 10 or half the damage taken, whichever is higher. Each source of damage is a separate save.
 */
export function concentrationSaveDc(damage: number): number {
  return Math.max(10, Math.floor(Math.max(0, damage) / 2));
}
