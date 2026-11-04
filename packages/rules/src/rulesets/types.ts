/**
 * A Ruleset is pure, JSON-serialisable data plus a few formula identifiers.
 * Keeping it data-only means homebrew rulesets can be stored in the database
 * and shared, and the engine never silently borrows a value from another version:
 * every number used by a calculation comes from the ruleset a campaign selected.
 */

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export interface AbilityDef {
  id: Ability;
  name: string;
  short: string;
}

export interface SkillDef {
  id: string;
  name: string;
  ability: Ability;
}

export interface ConditionDef {
  id: string;
  name: string;
  /** Short summary written for this project (not copied rules text). */
  summary: string;
  /** Conditions with numeric levels (e.g. exhaustion). */
  maxLevel?: number;
}

export type DiagonalRule =
  /** Every diagonal square costs one square (5e default). */
  | "uniform"
  /** Alternating 1-2-1 diagonals (optional 5e variant). */
  | "alternating"
  /** True euclidean distance. */
  | "euclidean";

export interface RulesetDefinition {
  /** Stable machine id, e.g. "dnd5e-2014". Homebrew ids are prefixed with "custom:". */
  id: string;
  name: string;
  /** Game system family; future RPG systems plug in with a different system id. */
  system: "dnd5e";
  version: string;
  /** Ruleset this one was derived from (homebrew), for display only. */
  baseRulesetId?: string;
  /** Source/licence attribution displayed in the UI. */
  attribution: string;
  abilities: AbilityDef[];
  skills: SkillDef[];
  conditions: ConditionDef[];
  /** Damage types this system recognises (resistance/vulnerability/immunity keys). */
  damageTypes: string[];
  /** Proficiency bonus for levels 1..N (index 0 = level 1). */
  proficiencyByLevel: number[];
  maxLevel: number;
  abilityScore: { min: number; max: number };
  /** XP needed to reach level index+1 (index 0 = level 1 = 0 XP). */
  xpThresholds: number[];
  movement: { unitsPerSquare: number; unit: string; diagonal: DiagonalRule };
  combat: {
    criticalOn: number;
    /** How critical damage is computed. */
    criticalDamage: "double-dice" | "max-plus-roll";
    deathSaves: { successesToStabilize: number; failuresToDie: number; dc: number };
    actionEconomy: Array<"action" | "bonusAction" | "reaction" | "movement" | "freeInteraction">;
  };
  spellcasting: { saveDcBase: number; maxSpellLevel: number };
  passiveCheckBase: number;
  /** How exhaustion affects d20 tests; numbers are per exhaustion level. */
  exhaustion: { model: "table-2014" | "flat-penalty"; d20PenaltyPerLevel: number; speedPenaltyPerLevel: number };
}
