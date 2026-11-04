import type { AbilityDef, ConditionDef, RulesetDefinition, SkillDef } from "./types.js";

/*
 * Data below is limited to game-mechanical facts available in the System Reference
 * Documents (SRD 5.1 and SRD 5.2, released under CC-BY-4.0 by Wizards of the Coast).
 * Condition summaries are short paraphrases written for this project.
 */

const SRD_51 =
  "Includes material from the System Reference Document 5.1 (SRD 5.1) by Wizards of the Coast LLC, licensed under CC-BY-4.0.";
const SRD_52 =
  "Includes material from the System Reference Document 5.2 (SRD 5.2) by Wizards of the Coast LLC, licensed under CC-BY-4.0.";

const abilities: AbilityDef[] = [
  { id: "str", name: "Strength", short: "STR" },
  { id: "dex", name: "Dexterity", short: "DEX" },
  { id: "con", name: "Constitution", short: "CON" },
  { id: "int", name: "Intelligence", short: "INT" },
  { id: "wis", name: "Wisdom", short: "WIS" },
  { id: "cha", name: "Charisma", short: "CHA" },
];

const skills: SkillDef[] = [
  { id: "acrobatics", name: "Acrobatics", ability: "dex" },
  { id: "animal_handling", name: "Animal Handling", ability: "wis" },
  { id: "arcana", name: "Arcana", ability: "int" },
  { id: "athletics", name: "Athletics", ability: "str" },
  { id: "deception", name: "Deception", ability: "cha" },
  { id: "history", name: "History", ability: "int" },
  { id: "insight", name: "Insight", ability: "wis" },
  { id: "intimidation", name: "Intimidation", ability: "cha" },
  { id: "investigation", name: "Investigation", ability: "int" },
  { id: "medicine", name: "Medicine", ability: "wis" },
  { id: "nature", name: "Nature", ability: "int" },
  { id: "perception", name: "Perception", ability: "wis" },
  { id: "performance", name: "Performance", ability: "cha" },
  { id: "persuasion", name: "Persuasion", ability: "cha" },
  { id: "religion", name: "Religion", ability: "int" },
  { id: "sleight_of_hand", name: "Sleight of Hand", ability: "dex" },
  { id: "stealth", name: "Stealth", ability: "dex" },
  { id: "survival", name: "Survival", ability: "wis" },
];

/** SRD damage types (identical in SRD 5.1 and 5.2). */
const damageTypes = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

const baseConditions: ConditionDef[] = [
  { id: "blinded", name: "Blinded", summary: "Can't see; fails sight checks. Attacks against it have advantage, its attacks have disadvantage." },
  { id: "charmed", name: "Charmed", summary: "Can't harm the charmer; the charmer has advantage on social checks against it." },
  { id: "deafened", name: "Deafened", summary: "Can't hear; fails hearing checks." },
  { id: "frightened", name: "Frightened", summary: "Disadvantage on checks and attacks while the source is in sight; can't willingly move closer to it." },
  { id: "grappled", name: "Grappled", summary: "Speed becomes 0." },
  { id: "incapacitated", name: "Incapacitated", summary: "Can't take actions or reactions." },
  { id: "invisible", name: "Invisible", summary: "Can't be seen without special senses. Attacks against it have disadvantage, its attacks have advantage." },
  { id: "paralyzed", name: "Paralyzed", summary: "Incapacitated, can't move or speak; fails STR/DEX saves; nearby hits are critical." },
  { id: "petrified", name: "Petrified", summary: "Turned to an inanimate substance; incapacitated, resistant to all damage." },
  { id: "poisoned", name: "Poisoned", summary: "Disadvantage on attack rolls and ability checks." },
  { id: "prone", name: "Prone", summary: "Crawls or stands up; melee attacks against it have advantage, ranged attacks disadvantage." },
  { id: "restrained", name: "Restrained", summary: "Speed 0; disadvantage on attacks and DEX saves; attacks against it have advantage." },
  { id: "stunned", name: "Stunned", summary: "Incapacitated; fails STR/DEX saves; attacks against it have advantage." },
  { id: "unconscious", name: "Unconscious", summary: "Incapacitated and prone, unaware; nearby hits are critical." },
];

const PB = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
const XP = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000,
  225000, 265000, 305000, 355000,
];

export const DND5E_2014: RulesetDefinition = {
  id: "dnd5e-2014",
  name: "D&D 5e (2014)",
  system: "dnd5e",
  version: "2014",
  attribution: SRD_51,
  abilities,
  skills,
  conditions: [
    ...baseConditions,
    {
      id: "exhaustion",
      name: "Exhaustion",
      maxLevel: 6,
      summary: "Six cumulative levels of escalating penalties (checks, speed, attacks/saves, HP max, speed 0, death).",
    },
  ],
  proficiencyByLevel: PB,
  maxLevel: 20,
  abilityScore: { min: 1, max: 30 },
  xpThresholds: XP,
  damageTypes,
  movement: { unitsPerSquare: 5, unit: "ft", diagonal: "uniform" },
  combat: {
    criticalOn: 20,
    criticalDamage: "double-dice",
    deathSaves: { successesToStabilize: 3, failuresToDie: 3, dc: 10 },
    actionEconomy: ["action", "bonusAction", "reaction", "movement", "freeInteraction"],
  },
  spellcasting: { saveDcBase: 8, maxSpellLevel: 9 },
  passiveCheckBase: 10,
  exhaustion: { model: "table-2014", d20PenaltyPerLevel: 0, speedPenaltyPerLevel: 0 },
};

export const DND5E_2024: RulesetDefinition = {
  id: "dnd5e-2024",
  name: "D&D 5e (2024 Revised)",
  system: "dnd5e",
  version: "2024",
  attribution: SRD_52,
  abilities,
  skills,
  conditions: [
    ...baseConditions,
    {
      id: "exhaustion",
      name: "Exhaustion",
      maxLevel: 6,
      summary: "Each level gives -2 to d20 tests and -5 ft speed; level 6 is death.",
    },
  ],
  proficiencyByLevel: PB,
  maxLevel: 20,
  abilityScore: { min: 1, max: 30 },
  xpThresholds: XP,
  damageTypes,
  movement: { unitsPerSquare: 5, unit: "ft", diagonal: "uniform" },
  combat: {
    criticalOn: 20,
    criticalDamage: "double-dice",
    deathSaves: { successesToStabilize: 3, failuresToDie: 3, dc: 10 },
    actionEconomy: ["action", "bonusAction", "reaction", "movement", "freeInteraction"],
  },
  spellcasting: { saveDcBase: 8, maxSpellLevel: 9 },
  passiveCheckBase: 10,
  exhaustion: { model: "flat-penalty", d20PenaltyPerLevel: 2, speedPenaltyPerLevel: 5 },
};
