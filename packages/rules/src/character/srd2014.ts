/**
 * Level-1 character creation for D&D 5e (2014) using only SRD 5.1 content: the nine
 * SRD races (each with its SRD subrace where there is one), the twelve classes, and the
 * Acolyte background, plus a free-form "custom" background for the player's own.
 *
 * Feature descriptions are short paraphrases written for this project. Equipment is
 * left to the player (the sheet's inventory), so the creator never invents items.
 *
 * Includes material from the System Reference Document 5.1 (SRD 5.1) by Wizards of the
 * Coast LLC, licensed under CC-BY-4.0.
 */
import { ABILITIES, type Ability, type RulesetDefinition } from "../rulesets/types.js";
import { abilityModifier } from "./derive.js";
import { characterDataSchema, type CharacterData } from "./schema.js";

export interface SrdTrait {
  name: string;
  description: string;
  uses?: number;
}

export interface SrdRace {
  id: string;
  name: string;
  /** Subrace shown in the species line, if the SRD has one for this race. */
  subrace?: string;
  bonuses: Partial<Record<Ability, number>>;
  /** Extra +1s the player places on abilities without a fixed bonus (Half-Elf). */
  freeBonuses?: number;
  speed: number;
  /** Skill proficiencies the race always grants. */
  skills?: string[];
  /** Extra skills of the player's choice (Half-Elf: 2). */
  skillChoices?: number;
  resistances?: string[];
  /** Extra max HP per level (Hill Dwarf). */
  hpPerLevel?: number;
  traits: SrdTrait[];
}

export interface SrdClass {
  id: string;
  name: string;
  /** The SRD's subclass for this class, chosen at level 1 only for some classes. */
  subclassAtLevel1?: string;
  hitDie: 6 | 8 | 10 | 12;
  saves: [Ability, Ability];
  skillCount: number;
  /** Skill ids to choose from; "any" means every skill. */
  skillOptions: string[] | "any";
  spellAbility?: Ability;
  /** Level-1 spell slots (index 0 = 1st level). */
  slots?: number[];
  /** Unarmored AC formula at level 1. */
  unarmored?: "barbarian" | "monk";
  /** Level-1 features. `uses` may depend on ability modifiers, so it's a function. */
  features: Array<{ name: string; description: string; subclass?: true; uses?: (mods: Record<Ability, number>) => number }>;
}

export interface SrdBackground {
  id: string;
  name: string;
  skills: string[];
  feature: SrdTrait;
}

export const SRD_RACES: SrdRace[] = [
  {
    id: "dwarf",
    name: "Dwarf",
    subrace: "Hill Dwarf",
    bonuses: { con: 2, wis: 1 },
    speed: 25,
    resistances: ["poison"],
    hpPerLevel: 1,
    traits: [
      { name: "Darkvision", description: "See in dim light within 60 ft as if bright, and in darkness as if dim (no colour)." },
      { name: "Dwarven Resilience", description: "Advantage on saves against poison, and resistance to poison damage." },
      { name: "Stonecunning", description: "Double proficiency on History checks about the origin of stonework." },
      { name: "Dwarven Toughness", description: "Hit point maximum increases by 1, and by 1 again every level." },
    ],
  },
  {
    id: "elf",
    name: "Elf",
    subrace: "High Elf",
    bonuses: { dex: 2, int: 1 },
    speed: 30,
    skills: ["perception"],
    traits: [
      { name: "Darkvision", description: "See in dim light within 60 ft as if bright, and in darkness as if dim (no colour)." },
      { name: "Keen Senses", description: "Proficiency in Perception." },
      { name: "Fey Ancestry", description: "Advantage on saves against being charmed; magic can't put you to sleep." },
      { name: "Trance", description: "Meditate 4 hours instead of sleeping 8." },
      { name: "Cantrip", description: "Know one wizard cantrip of your choice (Intelligence is the spellcasting ability)." },
    ],
  },
  {
    id: "halfling",
    name: "Halfling",
    subrace: "Lightfoot",
    bonuses: { dex: 2, cha: 1 },
    speed: 25,
    traits: [
      { name: "Lucky", description: "When you roll a 1 on an attack roll, ability check or saving throw, reroll and use the new roll." },
      { name: "Brave", description: "Advantage on saves against being frightened." },
      { name: "Halfling Nimbleness", description: "Move through the space of any creature larger than you." },
      { name: "Naturally Stealthy", description: "Can try to hide when obscured only by a creature at least one size larger." },
    ],
  },
  {
    id: "human",
    name: "Human",
    bonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    speed: 30,
    traits: [],
  },
  {
    id: "dragonborn",
    name: "Dragonborn",
    bonuses: { str: 2, cha: 1 },
    speed: 30,
    traits: [
      { name: "Draconic Ancestry", description: "Choose a dragon type; it sets your breath weapon's damage type and your resistance." },
      { name: "Breath Weapon", description: "Action: 2d6 damage in an area (DC 8 + CON mod + proficiency, half on a save). Once per short or long rest.", uses: 1 },
      { name: "Damage Resistance", description: "Resistance to the damage type of your draconic ancestry." },
    ],
  },
  {
    id: "gnome",
    name: "Gnome",
    subrace: "Rock Gnome",
    bonuses: { int: 2, con: 1 },
    speed: 25,
    traits: [
      { name: "Darkvision", description: "See in dim light within 60 ft as if bright, and in darkness as if dim (no colour)." },
      { name: "Gnome Cunning", description: "Advantage on Intelligence, Wisdom and Charisma saves against magic." },
      { name: "Artificer's Lore", description: "Double proficiency on History checks about magic items, alchemical objects or technology." },
      { name: "Tinker", description: "Build tiny clockwork devices with tinker's tools." },
    ],
  },
  {
    id: "half-elf",
    name: "Half-Elf",
    bonuses: { cha: 2 },
    freeBonuses: 2,
    speed: 30,
    skillChoices: 2,
    traits: [
      { name: "Darkvision", description: "See in dim light within 60 ft as if bright, and in darkness as if dim (no colour)." },
      { name: "Fey Ancestry", description: "Advantage on saves against being charmed; magic can't put you to sleep." },
      { name: "Skill Versatility", description: "Proficiency in two skills of your choice." },
    ],
  },
  {
    id: "half-orc",
    name: "Half-Orc",
    bonuses: { str: 2, con: 1 },
    speed: 30,
    skills: ["intimidation"],
    traits: [
      { name: "Darkvision", description: "See in dim light within 60 ft as if bright, and in darkness as if dim (no colour)." },
      { name: "Menacing", description: "Proficiency in Intimidation." },
      { name: "Relentless Endurance", description: "When reduced to 0 HP but not killed outright, drop to 1 HP instead. Once per long rest.", uses: 1 },
      { name: "Savage Attacks", description: "On a melee weapon critical hit, roll one weapon damage die again and add it." },
    ],
  },
  {
    id: "tiefling",
    name: "Tiefling",
    bonuses: { cha: 2, int: 1 },
    speed: 30,
    resistances: ["fire"],
    traits: [
      { name: "Darkvision", description: "See in dim light within 60 ft as if bright, and in darkness as if dim (no colour)." },
      { name: "Hellish Resistance", description: "Resistance to fire damage." },
      { name: "Infernal Legacy", description: "Know the thaumaturgy cantrip; more spells at levels 3 and 5 (Charisma is the spellcasting ability)." },
    ],
  },
];

const atLeast1 = (n: number) => Math.max(1, n);

export const SRD_CLASSES: SrdClass[] = [
  {
    id: "barbarian",
    name: "Barbarian",
    hitDie: 12,
    saves: ["str", "con"],
    skillCount: 2,
    skillOptions: ["animal_handling", "athletics", "intimidation", "nature", "perception", "survival"],
    unarmored: "barbarian",
    features: [
      { name: "Rage", description: "Bonus action: advantage on STR checks and saves, +2 melee damage, resistance to bludgeoning/piercing/slashing. Lasts 1 minute.", uses: () => 2 },
      { name: "Unarmored Defense", description: "Without armour, AC = 10 + DEX mod + CON mod (a shield still applies)." },
    ],
  },
  {
    id: "bard",
    name: "Bard",
    hitDie: 8,
    saves: ["dex", "cha"],
    skillCount: 3,
    skillOptions: "any",
    spellAbility: "cha",
    slots: [2],
    features: [
      { name: "Spellcasting", description: "Charisma-based. 2 cantrips and 4 spells known at level 1." },
      { name: "Bardic Inspiration", description: "Bonus action: a creature within 60 ft gains a d6 to add to one ability check, attack or save. Recharges on a long rest.", uses: (m) => atLeast1(m.cha) },
    ],
  },
  {
    id: "cleric",
    name: "Cleric",
    subclassAtLevel1: "Life Domain",
    hitDie: 8,
    saves: ["wis", "cha"],
    skillCount: 2,
    skillOptions: ["history", "insight", "medicine", "persuasion", "religion"],
    spellAbility: "wis",
    slots: [2],
    features: [
      { name: "Spellcasting", description: "Wisdom-based. 3 cantrips; prepare WIS mod + level spells from the cleric list." },
      { name: "Disciple of Life", subclass: true, description: "Healing spells of 1st level or higher restore an extra 2 + the spell's level HP." },
    ],
  },
  {
    id: "druid",
    name: "Druid",
    hitDie: 8,
    saves: ["int", "wis"],
    skillCount: 2,
    skillOptions: ["arcana", "animal_handling", "insight", "medicine", "nature", "perception", "religion", "survival"],
    spellAbility: "wis",
    slots: [2],
    features: [
      { name: "Druidic", description: "You know the secret language of druids." },
      { name: "Spellcasting", description: "Wisdom-based. 2 cantrips; prepare WIS mod + level spells from the druid list." },
    ],
  },
  {
    id: "fighter",
    name: "Fighter",
    hitDie: 10,
    saves: ["str", "con"],
    skillCount: 2,
    skillOptions: ["acrobatics", "animal_handling", "athletics", "history", "insight", "intimidation", "perception", "survival"],
    features: [
      { name: "Fighting Style", description: "Choose a fighting style (e.g. Archery, Defense, Dueling)." },
      { name: "Second Wind", description: "Bonus action: regain 1d10 + fighter level HP. Recharges on a short or long rest.", uses: () => 1 },
    ],
  },
  {
    id: "monk",
    name: "Monk",
    hitDie: 8,
    saves: ["str", "dex"],
    skillCount: 2,
    skillOptions: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"],
    unarmored: "monk",
    features: [
      { name: "Unarmored Defense", description: "Without armour or shield, AC = 10 + DEX mod + WIS mod." },
      { name: "Martial Arts", description: "Use DEX for unarmed/monk weapons, d4 unarmed damage, and an unarmed strike as a bonus action after attacking." },
    ],
  },
  {
    id: "paladin",
    name: "Paladin",
    hitDie: 10,
    saves: ["wis", "cha"],
    skillCount: 2,
    skillOptions: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"],
    spellAbility: "cha",
    features: [
      { name: "Divine Sense", description: "Action: sense celestials, fiends and undead within 60 ft until your next turn. Recharges on a long rest.", uses: (m) => atLeast1(1 + m.cha) },
      { name: "Lay on Hands", description: "Pool of healing equal to 5 × paladin level; touch to restore HP or spend 5 to cure a disease or poison." },
    ],
  },
  {
    id: "ranger",
    name: "Ranger",
    hitDie: 10,
    saves: ["str", "dex"],
    skillCount: 3,
    skillOptions: ["animal_handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"],
    spellAbility: "wis",
    features: [
      { name: "Favored Enemy", description: "Choose a creature type: advantage on Survival to track and INT checks to recall lore about them." },
      { name: "Natural Explorer", description: "Choose a favoured terrain where you travel and forage more effectively." },
    ],
  },
  {
    id: "rogue",
    name: "Rogue",
    hitDie: 8,
    saves: ["dex", "int"],
    skillCount: 4,
    skillOptions: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleight_of_hand", "stealth"],
    features: [
      { name: "Expertise", description: "Double proficiency for two of your skill proficiencies (or one skill and thieves' tools)." },
      { name: "Sneak Attack", description: "Once per turn, +1d6 damage to a finesse or ranged attack with advantage, or when an ally is next to the target." },
      { name: "Thieves' Cant", description: "Secret mix of jargon and signs known to rogues." },
    ],
  },
  {
    id: "sorcerer",
    name: "Sorcerer",
    subclassAtLevel1: "Draconic Bloodline",
    hitDie: 6,
    saves: ["con", "cha"],
    skillCount: 2,
    skillOptions: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"],
    spellAbility: "cha",
    slots: [2],
    features: [
      { name: "Spellcasting", description: "Charisma-based. 4 cantrips and 2 spells known at level 1." },
      { name: "Draconic Resilience", subclass: true, description: "HP max +1 per sorcerer level; unarmoured AC = 13 + DEX mod." },
    ],
  },
  {
    id: "warlock",
    name: "Warlock",
    subclassAtLevel1: "The Fiend",
    hitDie: 8,
    saves: ["wis", "cha"],
    skillCount: 2,
    skillOptions: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"],
    spellAbility: "cha",
    slots: [1],
    features: [
      { name: "Pact Magic", description: "Charisma-based. 2 cantrips and 2 spells known; one spell slot that recharges on a short or long rest." },
      { name: "Dark One's Blessing", subclass: true, description: "When you reduce a hostile creature to 0 HP, gain temporary HP equal to CHA mod + warlock level." },
    ],
  },
  {
    id: "wizard",
    name: "Wizard",
    hitDie: 6,
    saves: ["int", "wis"],
    skillCount: 2,
    skillOptions: ["arcana", "history", "insight", "investigation", "medicine", "religion"],
    spellAbility: "int",
    slots: [2],
    features: [
      { name: "Spellcasting", description: "Intelligence-based. 3 cantrips; a spellbook with six 1st-level spells; prepare INT mod + level." },
      { name: "Arcane Recovery", description: "Once per day after a short rest, recover spell slots totalling up to half your wizard level (rounded up).", uses: () => 1 },
    ],
  },
];

export const CUSTOM_BACKGROUND = "custom";

export const SRD_BACKGROUNDS: SrdBackground[] = [
  {
    id: "acolyte",
    name: "Acolyte",
    skills: ["insight", "religion"],
    feature: { name: "Shelter of the Faithful", description: "You and your companions can get free healing and care at temples of your faith." },
  },
];

/** The 2014 standard array. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const POINT_BUY_BUDGET = 27;
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

/** Points spent on base scores, or null if any score is outside 8–15. */
export function pointBuyCost(scores: Record<Ability, number>): number | null {
  let total = 0;
  for (const a of ABILITIES) {
    const c = POINT_COST[scores[a]];
    if (c === undefined) return null;
    total += c;
  }
  return total;
}

export type AbilityMethod = "standard" | "pointbuy" | "manual";

export interface CreatorChoices {
  name: string;
  raceId: string;
  classId: string;
  /** An SRD background id, or CUSTOM_BACKGROUND. */
  backgroundId: string;
  /** Name of the player's own background when backgroundId is CUSTOM_BACKGROUND. */
  customBackgroundName: string;
  /** Two skills the custom background grants. */
  customBackgroundSkills: string[];
  method: AbilityMethod;
  /** Base scores before racial bonuses. */
  baseAbilities: Record<Ability, number>;
  /** Half-Elf: abilities that get a free +1 (not CHA). */
  freeBonusAbilities: Ability[];
  classSkills: string[];
  /** Half-Elf: skills of the player's choice. */
  raceSkills: string[];
  alignment: string;
}

export function defaultCreatorChoices(): CreatorChoices {
  return {
    name: "",
    raceId: "human",
    classId: "fighter",
    backgroundId: "acolyte",
    customBackgroundName: "",
    customBackgroundSkills: [],
    method: "standard",
    baseAbilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    freeBonusAbilities: [],
    classSkills: [],
    raceSkills: [],
    alignment: "",
  };
}

const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id);

/** Skills already granted by race and background, which class/race choices can't repeat. */
export function fixedSkills(c: CreatorChoices): string[] {
  const race = byId(SRD_RACES, c.raceId);
  const bg = c.backgroundId === CUSTOM_BACKGROUND ? null : byId(SRD_BACKGROUNDS, c.backgroundId);
  const bgSkills = bg ? bg.skills : c.customBackgroundSkills;
  return [...new Set([...(race?.skills ?? []), ...bgSkills])];
}

/** Final scores: base + racial bonuses (+ Half-Elf free bonuses). */
export function finalAbilities(c: CreatorChoices): Record<Ability, number> {
  const race = byId(SRD_RACES, c.raceId);
  const out = { ...c.baseAbilities };
  for (const a of ABILITIES) out[a] += race?.bonuses[a] ?? 0;
  if (race?.freeBonuses) for (const a of c.freeBonusAbilities) out[a] += 1;
  return out;
}

/**
 * Every rule the choices break, as short English messages for the UI (empty = valid).
 * The ruleset is used for skill ids and ability limits.
 */
export function validateCreatorChoices(c: CreatorChoices, ruleset: RulesetDefinition): string[] {
  const errors: string[] = [];
  const race = byId(SRD_RACES, c.raceId);
  const cls = byId(SRD_CLASSES, c.classId);
  const skillIds = new Set(ruleset.skills.map((s) => s.id));
  if (!c.name.trim()) errors.push("Enter a name.");
  if (c.name.trim().length > 100) errors.push("Name is too long (100 characters max).");
  if (!race) errors.push("Choose a race.");
  if (!cls) errors.push("Choose a class.");

  if (c.backgroundId === CUSTOM_BACKGROUND) {
    if (!c.customBackgroundName.trim()) errors.push("Name your background.");
    if (new Set(c.customBackgroundSkills).size !== 2 || c.customBackgroundSkills.some((s) => !skillIds.has(s))) {
      errors.push("Choose two different skills for your background.");
    }
  } else if (!byId(SRD_BACKGROUNDS, c.backgroundId)) {
    errors.push("Choose a background.");
  }

  const base = c.baseAbilities;
  if (ABILITIES.some((a) => !Number.isInteger(base[a]))) errors.push("Ability scores must be whole numbers.");
  else if (c.method === "standard") {
    const sorted = ABILITIES.map((a) => base[a]).sort((x, y) => y - x);
    if (sorted.some((v, i) => v !== STANDARD_ARRAY[i])) errors.push("Use each standard array value (15, 14, 13, 12, 10, 8) once.");
  } else if (c.method === "pointbuy") {
    const cost = pointBuyCost(base);
    if (cost === null) errors.push("Point buy scores must be between 8 and 15.");
    else if (cost > POINT_BUY_BUDGET) errors.push(`Point buy is over budget (${cost}/${POINT_BUY_BUDGET}).`);
  } else if (ABILITIES.some((a) => base[a] < 3 || base[a] > 18)) {
    errors.push("Rolled or manual scores must be between 3 and 18.");
  }

  if (race?.freeBonuses) {
    const free = new Set(c.freeBonusAbilities);
    if (free.size !== race.freeBonuses || c.freeBonusAbilities.some((a) => !ABILITIES.includes(a) || (race.bonuses[a] ?? 0) > 0)) {
      errors.push(`Choose ${race.freeBonuses} different abilities for the +1 bonuses (not ones the race already raises).`);
    }
  }
  const fin = finalAbilities(c);
  if (ABILITIES.some((a) => fin[a] > Math.min(20, ruleset.abilityScore.max))) errors.push("A score can't go above 20 at level 1.");

  const fixed = new Set(fixedSkills(c));
  if (cls) {
    const options = cls.skillOptions === "any" ? [...skillIds] : cls.skillOptions;
    const picked = new Set(c.classSkills);
    if (picked.size !== cls.skillCount || c.classSkills.some((s) => !options.includes(s))) {
      errors.push(`Choose ${cls.skillCount} skills from the ${cls.name} list.`);
    } else if (c.classSkills.some((s) => fixed.has(s))) {
      errors.push("A class skill repeats one your race or background already gives; pick another.");
    }
  }
  if (race?.skillChoices) {
    const picked = new Set(c.raceSkills);
    if (picked.size !== race.skillChoices || c.raceSkills.some((s) => !skillIds.has(s))) {
      errors.push(`Choose ${race.skillChoices} skills for ${race.name}.`);
    } else if (c.raceSkills.some((s) => fixed.has(s) || c.classSkills.includes(s))) {
      errors.push(`${race.name} skills must differ from your other skills.`);
    }
  }
  return errors;
}

/** Thrown by buildSrdCharacter when the choices are invalid. */
export class CreatorError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(" "));
  }
}

/**
 * Builds a level-1 character from valid choices. Everything it sets stays editable on
 * the sheet afterwards; derived numbers (modifiers, saves, skills) are computed there.
 */
export function buildSrdCharacter(c: CreatorChoices, ruleset: RulesetDefinition): { name: string; data: CharacterData } {
  const errors = validateCreatorChoices(c, ruleset);
  if (errors.length) throw new CreatorError(errors);
  const race = byId(SRD_RACES, c.raceId)!;
  const cls = byId(SRD_CLASSES, c.classId)!;
  const bg = c.backgroundId === CUSTOM_BACKGROUND ? null : byId(SRD_BACKGROUNDS, c.backgroundId)!;

  const abilities = finalAbilities(c);
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityModifier(abilities[a])])) as Record<Ability, number>;
  const draconic = cls.subclassAtLevel1 === "Draconic Bloodline";
  const hp = Math.max(1, cls.hitDie + mods.con + (race.hpPerLevel ?? 0) + (draconic ? 1 : 0));
  const armorClass =
    cls.unarmored === "barbarian" ? 10 + mods.dex + mods.con : cls.unarmored === "monk" ? 10 + mods.dex + mods.wis : draconic ? 13 + mods.dex : 10 + mods.dex;

  const skills: Record<string, "proficient"> = {};
  for (const s of [...fixedSkills(c), ...c.classSkills, ...(race.skillChoices ? c.raceSkills : [])]) skills[s] = "proficient";

  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const features = [
    ...cls.features.map((f) => ({
      id: id("feat"),
      name: f.name,
      source: f.subclass ? ("subclass" as const) : ("class" as const),
      description: f.description,
      uses: f.uses ? { max: Math.min(99, f.uses(mods)), used: 0 } : null,
    })),
    ...race.traits.map((t) => ({ id: id("feat"), name: t.name, source: "species" as const, description: t.description, uses: t.uses ? { max: t.uses, used: 0 } : null })),
    ...(bg ? [{ id: id("feat"), name: bg.feature.name, source: "background" as const, description: bg.feature.description, uses: null }] : []),
  ];

  const slots = Array.from({ length: 9 }, (_, i) => ({ max: cls.slots?.[i] ?? 0, used: 0 }));
  const data = characterDataSchema.parse({
    classes: [{ name: cls.name, subclass: cls.subclassAtLevel1 ?? "", level: 1, hitDie: cls.hitDie }],
    species: race.subrace ?? race.name,
    background: bg ? bg.name : c.customBackgroundName.trim().slice(0, 60),
    alignment: c.alignment.trim().slice(0, 40),
    abilities,
    saveProficiencies: cls.saves,
    skills,
    armorClass: Math.max(0, armorClass),
    speed: race.speed,
    hp: { max: hp, current: hp, temp: 0 },
    defenses: { resistances: race.resistances ?? [], vulnerabilities: [], immunities: [] },
    features,
    spellcasting: { ability: cls.spellAbility ?? "none", slots, spells: [] },
  });
  return { name: c.name.trim(), data };
}
