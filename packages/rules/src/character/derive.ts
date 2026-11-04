import type { Ability, RulesetDefinition } from "../rulesets/types.js";
import type { CharacterData, ProficiencyLevel } from "./schema.js";

/** A computed number plus where it came from, so the UI can show overrides. */
export interface Derived {
  value: number;
  source: "computed" | "override";
}

export interface DerivedSkill extends Derived {
  id: string;
  name: string;
  ability: Ability;
  proficiency: ProficiencyLevel;
  rollMode: "normal" | "advantage" | "disadvantage";
  passive: number;
}

export interface DerivedAttack {
  id: string;
  name: string;
  attackBonus: Derived | null;
  damageFormula: string;
  damageType: string;
}

export interface DerivedCharacter {
  rulesetId: string;
  totalLevel: number;
  proficiencyBonus: Derived;
  abilityModifiers: Record<Ability, number>;
  savingThrows: Record<Ability, Derived & { proficient: boolean }>;
  skills: DerivedSkill[];
  initiative: Derived;
  passivePerception: Derived;
  spellSaveDc: Derived | null;
  spellAttackBonus: Derived | null;
  attacks: DerivedAttack[];
  hitDice: { total: number; remaining: number; byDie: Record<string, number> };
  speed: number;
  /** Penalty applied to every d20 test (e.g. 2024 exhaustion). */
  d20Penalty: number;
  nextLevelXp: number | null;
  warnings: string[];
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonusForLevel(ruleset: RulesetDefinition, level: number): number {
  const clamped = Math.max(1, Math.min(level, ruleset.proficiencyByLevel.length));
  return ruleset.proficiencyByLevel[clamped - 1]!;
}

export function proficiencyMultiplier(level: ProficiencyLevel): number {
  switch (level) {
    case "none":
      return 0;
    case "half":
      return 0.5;
    case "proficient":
      return 1;
    case "expertise":
      return 2;
  }
}

function pick(computed: number, override: number | undefined): Derived {
  return override === undefined ? { value: computed, source: "computed" } : { value: override, source: "override" };
}

export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Computes every rules-driven number on a character sheet for a given ruleset. */
export function deriveCharacter(data: CharacterData, ruleset: RulesetDefinition): DerivedCharacter {
  const warnings: string[] = [];
  const totalLevel = data.classes.reduce((s, c) => s + c.level, 0) || 1;
  if (totalLevel > ruleset.maxLevel) {
    warnings.push(`Total level ${totalLevel} exceeds the ruleset maximum of ${ruleset.maxLevel}.`);
  }
  for (const a of ruleset.abilities) {
    const score = data.abilities[a.id];
    if (score < ruleset.abilityScore.min || score > ruleset.abilityScore.max) {
      warnings.push(`${a.short} ${score} is outside ${ruleset.abilityScore.min}-${ruleset.abilityScore.max}.`);
    }
  }

  const pb = pick(proficiencyBonusForLevel(ruleset, totalLevel), data.overrides.proficiencyBonus);
  const mods = Object.fromEntries(
    ruleset.abilities.map((a) => [a.id, abilityModifier(data.abilities[a.id])]),
  ) as Record<Ability, number>;

  // Exhaustion (2024 model) applies a flat penalty to d20 tests and speed.
  const exhaustion = data.conditions.find((c) => c.id === "exhaustion");
  const exhaustionLevel = exhaustion ? (exhaustion.level ?? 1) : 0;
  const d20Penalty =
    ruleset.exhaustion.model === "flat-penalty" ? exhaustionLevel * ruleset.exhaustion.d20PenaltyPerLevel : 0;
  let speed = data.speed;
  if (ruleset.exhaustion.model === "flat-penalty") {
    speed = Math.max(0, speed - exhaustionLevel * ruleset.exhaustion.speedPenaltyPerLevel);
  } else if (ruleset.exhaustion.model === "table-2014") {
    if (exhaustionLevel >= 5) speed = 0;
    else if (exhaustionLevel >= 2) speed = Math.floor(speed / 2);
  }
  if (data.conditions.some((c) => c.id === "grappled" || c.id === "restrained")) speed = 0;

  const savingThrows = Object.fromEntries(
    ruleset.abilities.map((a) => {
      const proficient = data.saveProficiencies.includes(a.id);
      const value = mods[a.id] + (proficient ? pb.value : 0) - d20Penalty;
      return [a.id, { value, source: "computed" as const, proficient }];
    }),
  ) as DerivedCharacter["savingThrows"];

  const skills: DerivedSkill[] = ruleset.skills.map((s) => {
    const proficiency = data.skills[s.id] ?? "none";
    const value = mods[s.ability] + Math.floor(pb.value * proficiencyMultiplier(proficiency)) - d20Penalty;
    const rollMode = data.skillRollModes[s.id] ?? "normal";
    // Passive checks: +5 with advantage, -5 with disadvantage.
    const passive =
      ruleset.passiveCheckBase + value + (rollMode === "advantage" ? 5 : rollMode === "disadvantage" ? -5 : 0);
    return { id: s.id, name: s.name, ability: s.ability, proficiency, rollMode, value, source: "computed", passive };
  });

  const perception = skills.find((s) => s.id === "perception");
  const passivePerception = pick(
    perception ? perception.passive : ruleset.passiveCheckBase + mods.wis,
    data.overrides.passivePerception,
  );
  const initiative = pick(mods.dex - d20Penalty, data.overrides.initiative);

  const castingAbility = data.spellcasting.ability;
  const spellSaveDc =
    castingAbility === "none"
      ? data.overrides.spellSaveDc !== undefined
        ? pick(0, data.overrides.spellSaveDc)
        : null
      : pick(ruleset.spellcasting.saveDcBase + pb.value + mods[castingAbility], data.overrides.spellSaveDc);
  const spellAttackBonus =
    castingAbility === "none"
      ? data.overrides.spellAttackBonus !== undefined
        ? pick(0, data.overrides.spellAttackBonus)
        : null
      : pick(pb.value + mods[castingAbility] - d20Penalty, data.overrides.spellAttackBonus);

  const attacks: DerivedAttack[] = data.attacks.map((atk) => {
    let abilityMod = 0;
    if (atk.ability === "spell") abilityMod = castingAbility === "none" ? 0 : mods[castingAbility];
    else if (atk.ability !== "none") abilityMod = mods[atk.ability];
    const computed = abilityMod + (atk.proficient ? pb.value : 0) + atk.magicBonus - d20Penalty;
    const attackBonus =
      atk.attackBonusOverride === null
        ? { value: computed, source: "computed" as const }
        : { value: atk.attackBonusOverride, source: "override" as const };
    let damageFormula = atk.damage;
    if (damageFormula) {
      const flat = (atk.addAbilityToDamage ? abilityMod : 0) + atk.magicBonus;
      if (flat !== 0) damageFormula += flat > 0 ? `+${flat}` : `${flat}`;
    }
    return { id: atk.id, name: atk.name, attackBonus, damageFormula, damageType: atk.damageType };
  });

  const byDie: Record<string, number> = {};
  for (const c of data.classes) byDie[`d${c.hitDie}`] = (byDie[`d${c.hitDie}`] ?? 0) + c.level;
  const hdTotal = data.classes.reduce((s, c) => s + c.level, 0);
  if (data.hitDiceUsed > hdTotal) warnings.push("More hit dice used than available.");

  const nextIdx = totalLevel; // threshold for level totalLevel+1
  const nextLevelXp = nextIdx < ruleset.xpThresholds.length ? ruleset.xpThresholds[nextIdx]! : null;

  return {
    rulesetId: ruleset.id,
    totalLevel,
    proficiencyBonus: pb,
    abilityModifiers: mods,
    savingThrows,
    skills,
    initiative,
    passivePerception,
    spellSaveDc,
    spellAttackBonus,
    attacks,
    hitDice: { total: hdTotal, remaining: Math.max(0, hdTotal - data.hitDiceUsed), byDie },
    speed,
    d20Penalty,
    nextLevelXp,
    warnings,
  };
}

export type HpChange =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "temp"; amount: number };

/**
 * Applies damage/healing/temp HP using 5e rules: damage depletes temp HP first,
 * healing cannot exceed max, temp HP doesn't stack (keep the higher).
 */
export function applyHpChange(
  hp: { max: number; current: number; temp: number },
  change: HpChange,
): { max: number; current: number; temp: number } {
  const amount = Math.max(0, Math.floor(change.amount));
  switch (change.kind) {
    case "damage": {
      const fromTemp = Math.min(hp.temp, amount);
      const rest = amount - fromTemp;
      return { max: hp.max, temp: hp.temp - fromTemp, current: Math.max(0, hp.current - rest) };
    }
    case "heal":
      return { ...hp, current: Math.min(hp.max, Math.max(0, hp.current) + amount) };
    case "temp":
      return { ...hp, temp: Math.max(hp.temp, amount) };
  }
}
