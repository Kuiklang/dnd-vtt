/**
 * A starter bestiary of creatures from the System Reference Document 5.1. Numbers
 * (AC, HP, abilities, attacks, CR) follow the SRD; trait and action text is a short
 * paraphrase written for this project. DMs can copy any entry into their campaign and
 * edit it there.
 *
 * Includes material from the System Reference Document 5.1 (SRD 5.1) by Wizards of the
 * Coast LLC, licensed under CC-BY-4.0.
 */
import { ABILITIES, type Ability } from "../rulesets/types.js";
import { roll } from "../dice/roller.js";
import { abilityModifier } from "../character/derive.js";
import { characterDataSchema, type CharacterData, type Defenses } from "../character/schema.js";
import type { Rng } from "../rng.js";

export interface MonsterAction {
  name: string;
  description: string;
  /** To-hit bonus for attack actions. */
  attackBonus?: number;
  /** Damage dice formula, e.g. "1d6+2". */
  damage?: string;
  damageType?: string;
  /** Extra damage on hit, e.g. "1d6" fire on a young red dragon bite. */
  extraDamage?: { formula: string; type: string };
}

export interface MonsterTrait {
  name: string;
  description: string;
}

export interface SrdMonster {
  id: string;
  name: string;
  size: "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan";
  type: string;
  alignment: string;
  ac: number;
  acNote?: string;
  hp: number;
  hitDice: string;
  speed: string;
  /** Speed in feet used on the map (walking). */
  walk: number;
  abilities: Record<Ability, number>;
  saves?: Partial<Record<Ability, number>>;
  /** Skill bonuses by ruleset skill id. */
  skills?: Record<string, number>;
  resistances?: string[];
  immunities?: string[];
  vulnerabilities?: string[];
  conditionImmunities?: string[];
  senses: string;
  languages: string;
  /** Challenge rating as printed: "0", "1/8", "1/4", "1/2", "1", … */
  cr: string;
  xp: number;
  traits: MonsterTrait[];
  actions: MonsterAction[];
  reactions?: MonsterTrait[];
}

const a = (str: number, dex: number, con: number, int: number, wis: number, cha: number) => ({ str, dex, con, int, wis, cha });

export const SRD_MONSTERS: SrdMonster[] = [
  {
    id: "commoner", name: "Commoner", size: "Medium", type: "humanoid (any race)", alignment: "any alignment",
    ac: 10, hp: 4, hitDice: "1d8", speed: "30 ft.", walk: 30, abilities: a(10, 10, 10, 10, 10, 10),
    senses: "passive Perception 10", languages: "any one language (usually Common)", cr: "0", xp: 10,
    traits: [],
    actions: [{ name: "Club", description: "Melee weapon attack, reach 5 ft.", attackBonus: 2, damage: "1d4", damageType: "bludgeoning" }],
  },
  {
    id: "kobold", name: "Kobold", size: "Small", type: "humanoid (kobold)", alignment: "lawful evil",
    ac: 12, hp: 5, hitDice: "2d6-2", speed: "30 ft.", walk: 30, abilities: a(7, 15, 9, 8, 7, 8),
    senses: "darkvision 60 ft., passive Perception 8", languages: "Common, Draconic", cr: "1/8", xp: 25,
    traits: [
      { name: "Sunlight Sensitivity", description: "Disadvantage on attacks and sight-based Perception while in sunlight." },
      { name: "Pack Tactics", description: "Advantage on attacks against a creature with an ally of the kobold within 5 ft. of it." },
    ],
    actions: [
      { name: "Dagger", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "1d4+2", damageType: "piercing" },
      { name: "Sling", description: "Ranged weapon attack, range 30/120 ft.", attackBonus: 4, damage: "1d4+2", damageType: "bludgeoning" },
    ],
  },
  {
    id: "giant-rat", name: "Giant Rat", size: "Small", type: "beast", alignment: "unaligned",
    ac: 12, hp: 7, hitDice: "2d6", speed: "30 ft.", walk: 30, abilities: a(7, 15, 11, 2, 10, 4),
    senses: "darkvision 60 ft., passive Perception 10", languages: "—", cr: "1/8", xp: 25,
    traits: [
      { name: "Keen Smell", description: "Advantage on Perception checks that rely on smell." },
      { name: "Pack Tactics", description: "Advantage on attacks against a creature with an ally of the rat within 5 ft. of it." },
    ],
    actions: [{ name: "Bite", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "1d4+2", damageType: "piercing" }],
  },
  {
    id: "bandit", name: "Bandit", size: "Medium", type: "humanoid (any race)", alignment: "any non-lawful alignment",
    ac: 12, acNote: "leather armor", hp: 11, hitDice: "2d8+2", speed: "30 ft.", walk: 30, abilities: a(11, 12, 12, 10, 10, 10),
    senses: "passive Perception 10", languages: "any one language (usually Common)", cr: "1/8", xp: 25,
    traits: [],
    actions: [
      { name: "Scimitar", description: "Melee weapon attack, reach 5 ft.", attackBonus: 3, damage: "1d6+1", damageType: "slashing" },
      { name: "Light Crossbow", description: "Ranged weapon attack, range 80/320 ft.", attackBonus: 3, damage: "1d8+1", damageType: "piercing" },
    ],
  },
  {
    id: "guard", name: "Guard", size: "Medium", type: "humanoid (any race)", alignment: "any alignment",
    ac: 16, acNote: "chain shirt, shield", hp: 11, hitDice: "2d8+2", speed: "30 ft.", walk: 30, abilities: a(13, 12, 12, 10, 11, 10),
    skills: { perception: 2 }, senses: "passive Perception 12", languages: "any one language (usually Common)", cr: "1/8", xp: 25,
    traits: [],
    actions: [{ name: "Spear", description: "Melee or ranged (20/60 ft.); 1d8+1 if used with two hands in melee.", attackBonus: 3, damage: "1d6+1", damageType: "piercing" }],
  },
  {
    id: "cultist", name: "Cultist", size: "Medium", type: "humanoid (any race)", alignment: "any non-good alignment",
    ac: 12, acNote: "leather armor", hp: 9, hitDice: "2d8", speed: "30 ft.", walk: 30, abilities: a(11, 12, 10, 10, 11, 10),
    skills: { deception: 2, religion: 2 }, senses: "passive Perception 10", languages: "any one language (usually Common)", cr: "1/8", xp: 25,
    traits: [{ name: "Dark Devotion", description: "Advantage on saves against being charmed or frightened." }],
    actions: [{ name: "Scimitar", description: "Melee weapon attack, reach 5 ft.", attackBonus: 3, damage: "1d6+1", damageType: "slashing" }],
  },
  {
    id: "goblin", name: "Goblin", size: "Small", type: "humanoid (goblinoid)", alignment: "neutral evil",
    ac: 15, acNote: "leather armor, shield", hp: 7, hitDice: "2d6", speed: "30 ft.", walk: 30, abilities: a(8, 14, 10, 10, 8, 8),
    skills: { stealth: 6 }, senses: "darkvision 60 ft., passive Perception 9", languages: "Common, Goblin", cr: "1/4", xp: 50,
    traits: [{ name: "Nimble Escape", description: "Can Disengage or Hide as a bonus action on each of its turns." }],
    actions: [
      { name: "Scimitar", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "1d6+2", damageType: "slashing" },
      { name: "Shortbow", description: "Ranged weapon attack, range 80/320 ft.", attackBonus: 4, damage: "1d6+2", damageType: "piercing" },
    ],
  },
  {
    id: "skeleton", name: "Skeleton", size: "Medium", type: "undead", alignment: "lawful evil",
    ac: 13, acNote: "armor scraps", hp: 13, hitDice: "2d8+4", speed: "30 ft.", walk: 30, abilities: a(10, 14, 15, 6, 8, 5),
    vulnerabilities: ["bludgeoning"], immunities: ["poison"], conditionImmunities: ["exhaustion", "poisoned"],
    senses: "darkvision 60 ft., passive Perception 9", languages: "understands the languages it knew in life but can't speak", cr: "1/4", xp: 50,
    traits: [],
    actions: [
      { name: "Shortsword", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "1d6+2", damageType: "piercing" },
      { name: "Shortbow", description: "Ranged weapon attack, range 80/320 ft.", attackBonus: 4, damage: "1d6+2", damageType: "piercing" },
    ],
  },
  {
    id: "zombie", name: "Zombie", size: "Medium", type: "undead", alignment: "neutral evil",
    ac: 8, hp: 22, hitDice: "3d8+9", speed: "20 ft.", walk: 20, abilities: a(13, 6, 16, 3, 6, 5),
    saves: { wis: 0 }, immunities: ["poison"], conditionImmunities: ["poisoned"],
    senses: "darkvision 60 ft., passive Perception 8", languages: "understands the languages it knew in life but can't speak", cr: "1/4", xp: 50,
    traits: [{ name: "Undead Fortitude", description: "If damage drops it to 0 HP, it makes a CON save (DC 5 + damage taken) to drop to 1 HP instead, unless the damage was radiant or from a critical hit." }],
    actions: [{ name: "Slam", description: "Melee weapon attack, reach 5 ft.", attackBonus: 3, damage: "1d6+1", damageType: "bludgeoning" }],
  },
  {
    id: "wolf", name: "Wolf", size: "Medium", type: "beast", alignment: "unaligned",
    ac: 13, acNote: "natural armor", hp: 11, hitDice: "2d8+2", speed: "40 ft.", walk: 40, abilities: a(12, 15, 12, 3, 12, 6),
    skills: { perception: 3, stealth: 4 }, senses: "passive Perception 13", languages: "—", cr: "1/4", xp: 50,
    traits: [
      { name: "Keen Hearing and Smell", description: "Advantage on Perception checks that rely on hearing or smell." },
      { name: "Pack Tactics", description: "Advantage on attacks against a creature with an ally of the wolf within 5 ft. of it." },
    ],
    actions: [{ name: "Bite", description: "Melee weapon attack, reach 5 ft. On a hit, the target makes a DC 11 STR save or is knocked prone.", attackBonus: 4, damage: "2d4+2", damageType: "piercing" }],
  },
  {
    id: "orc", name: "Orc", size: "Medium", type: "humanoid (orc)", alignment: "chaotic evil",
    ac: 13, acNote: "hide armor", hp: 15, hitDice: "2d8+6", speed: "30 ft.", walk: 30, abilities: a(16, 12, 16, 7, 11, 10),
    skills: { intimidation: 2 }, senses: "darkvision 60 ft., passive Perception 10", languages: "Common, Orc", cr: "1/2", xp: 100,
    traits: [{ name: "Aggressive", description: "As a bonus action, moves up to its speed toward a hostile creature it can see." }],
    actions: [
      { name: "Greataxe", description: "Melee weapon attack, reach 5 ft.", attackBonus: 5, damage: "1d12+3", damageType: "slashing" },
      { name: "Javelin", description: "Melee or ranged (30/120 ft.).", attackBonus: 5, damage: "1d6+3", damageType: "piercing" },
    ],
  },
  {
    id: "gnoll", name: "Gnoll", size: "Medium", type: "humanoid (gnoll)", alignment: "chaotic evil",
    ac: 15, acNote: "hide armor, shield", hp: 22, hitDice: "5d8", speed: "30 ft.", walk: 30, abilities: a(14, 12, 11, 6, 10, 7),
    senses: "darkvision 60 ft., passive Perception 10", languages: "Gnoll", cr: "1/2", xp: 100,
    traits: [{ name: "Rampage", description: "After reducing a creature to 0 HP with a melee attack, can move up to half its speed and make a bite attack as a bonus action." }],
    actions: [
      { name: "Bite", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "1d4+2", damageType: "piercing" },
      { name: "Spear", description: "Melee or ranged (20/60 ft.).", attackBonus: 4, damage: "1d6+2", damageType: "piercing" },
      { name: "Longbow", description: "Ranged weapon attack, range 150/600 ft.", attackBonus: 3, damage: "1d8+1", damageType: "piercing" },
    ],
  },
  {
    id: "hobgoblin", name: "Hobgoblin", size: "Medium", type: "humanoid (goblinoid)", alignment: "lawful evil",
    ac: 18, acNote: "chain mail, shield", hp: 11, hitDice: "2d8+2", speed: "30 ft.", walk: 30, abilities: a(13, 12, 12, 10, 10, 9),
    senses: "darkvision 60 ft., passive Perception 10", languages: "Common, Goblin", cr: "1/2", xp: 100,
    traits: [{ name: "Martial Advantage", description: "Once per turn, +2d6 damage to a creature it hits if an ally of the hobgoblin is within 5 ft. of that creature." }],
    actions: [
      { name: "Longsword", description: "Melee weapon attack, reach 5 ft.", attackBonus: 3, damage: "1d8+1", damageType: "slashing" },
      { name: "Longbow", description: "Ranged weapon attack, range 150/600 ft.", attackBonus: 3, damage: "1d8+1", damageType: "piercing" },
    ],
  },
  {
    id: "thug", name: "Thug", size: "Medium", type: "humanoid (any race)", alignment: "any non-good alignment",
    ac: 11, acNote: "leather armor", hp: 32, hitDice: "5d8+10", speed: "30 ft.", walk: 30, abilities: a(15, 11, 14, 10, 10, 11),
    skills: { intimidation: 2 }, senses: "passive Perception 10", languages: "any one language (usually Common)", cr: "1/2", xp: 100,
    traits: [{ name: "Pack Tactics", description: "Advantage on attacks against a creature with an ally of the thug within 5 ft. of it." }],
    actions: [
      { name: "Multiattack", description: "Makes two melee attacks." },
      { name: "Mace", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "1d6+2", damageType: "bludgeoning" },
      { name: "Heavy Crossbow", description: "Ranged weapon attack, range 100/400 ft.", attackBonus: 2, damage: "1d10", damageType: "piercing" },
    ],
  },
  {
    id: "bugbear", name: "Bugbear", size: "Medium", type: "humanoid (goblinoid)", alignment: "chaotic evil",
    ac: 16, acNote: "hide armor, shield", hp: 27, hitDice: "5d8+5", speed: "30 ft.", walk: 30, abilities: a(15, 14, 13, 8, 11, 9),
    skills: { stealth: 6, survival: 2 }, senses: "darkvision 60 ft., passive Perception 10", languages: "Common, Goblin", cr: "1", xp: 200,
    traits: [
      { name: "Brute", description: "A melee weapon deals one extra die of its damage when the bugbear hits with it (included)." },
      { name: "Surprise Attack", description: "+2d6 damage on a hit against a surprised creature in the first round of combat." },
    ],
    actions: [
      { name: "Morningstar", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "2d8+2", damageType: "piercing" },
      { name: "Javelin", description: "Melee 2d6+2, or ranged (30/120 ft.) 1d6+2.", attackBonus: 4, damage: "2d6+2", damageType: "piercing" },
    ],
  },
  {
    id: "ghoul", name: "Ghoul", size: "Medium", type: "undead", alignment: "chaotic evil",
    ac: 12, hp: 22, hitDice: "5d8", speed: "30 ft.", walk: 30, abilities: a(13, 15, 10, 7, 10, 6),
    immunities: ["poison"], conditionImmunities: ["charmed", "exhaustion", "poisoned"],
    senses: "darkvision 60 ft., passive Perception 10", languages: "Common", cr: "1", xp: 200,
    traits: [],
    actions: [
      { name: "Bite", description: "Melee weapon attack, reach 5 ft., one creature.", attackBonus: 2, damage: "2d6+2", damageType: "piercing" },
      { name: "Claws", description: "Melee weapon attack, reach 5 ft. A creature that isn't an elf or undead makes a DC 10 CON save or is paralyzed for 1 minute (repeats the save at the end of each turn).", attackBonus: 4, damage: "2d4+2", damageType: "slashing" },
    ],
  },
  {
    id: "dire-wolf", name: "Dire Wolf", size: "Large", type: "beast", alignment: "unaligned",
    ac: 14, acNote: "natural armor", hp: 37, hitDice: "5d10+10", speed: "50 ft.", walk: 50, abilities: a(17, 15, 15, 3, 12, 7),
    skills: { perception: 3, stealth: 4 }, senses: "passive Perception 13", languages: "—", cr: "1", xp: 200,
    traits: [
      { name: "Keen Hearing and Smell", description: "Advantage on Perception checks that rely on hearing or smell." },
      { name: "Pack Tactics", description: "Advantage on attacks against a creature with an ally of the wolf within 5 ft. of it." },
    ],
    actions: [{ name: "Bite", description: "Melee weapon attack, reach 5 ft. On a hit, the target makes a DC 13 STR save or is knocked prone.", attackBonus: 5, damage: "2d6+3", damageType: "piercing" }],
  },
  {
    id: "brown-bear", name: "Brown Bear", size: "Large", type: "beast", alignment: "unaligned",
    ac: 11, acNote: "natural armor", hp: 34, hitDice: "4d10+12", speed: "40 ft., climb 30 ft.", walk: 40, abilities: a(19, 10, 16, 2, 13, 7),
    skills: { perception: 3 }, senses: "passive Perception 13", languages: "—", cr: "1", xp: 200,
    traits: [{ name: "Keen Smell", description: "Advantage on Perception checks that rely on smell." }],
    actions: [
      { name: "Multiattack", description: "Makes two attacks: one with its bite and one with its claws." },
      { name: "Bite", description: "Melee weapon attack, reach 5 ft.", attackBonus: 6, damage: "1d8+4", damageType: "piercing" },
      { name: "Claws", description: "Melee weapon attack, reach 5 ft.", attackBonus: 6, damage: "2d6+4", damageType: "slashing" },
    ],
  },
  {
    id: "giant-spider", name: "Giant Spider", size: "Large", type: "beast", alignment: "unaligned",
    ac: 14, acNote: "natural armor", hp: 26, hitDice: "4d10+4", speed: "30 ft., climb 30 ft.", walk: 30, abilities: a(14, 16, 12, 2, 11, 4),
    skills: { stealth: 7 }, senses: "blindsight 10 ft., darkvision 60 ft., passive Perception 10", languages: "—", cr: "1", xp: 200,
    traits: [
      { name: "Spider Climb", description: "Climbs difficult surfaces, including ceilings, without an ability check." },
      { name: "Web Sense", description: "Knows the location of any creature touching the same web." },
      { name: "Web Walker", description: "Ignores movement restrictions caused by webbing." },
    ],
    actions: [
      { name: "Bite", description: "Melee weapon attack, reach 5 ft. The target makes a DC 11 CON save, taking 2d8 poison damage on a failure or half on a success.", attackBonus: 5, damage: "1d8+3", damageType: "piercing", extraDamage: { formula: "2d8", type: "poison" } },
      { name: "Web (Recharge 5–6)", description: "Ranged attack, range 30/60 ft. On a hit the target is restrained by webbing (DC 12 STR to escape; the web has AC 10, 5 HP).", attackBonus: 5 },
    ],
  },
  {
    id: "bandit-captain", name: "Bandit Captain", size: "Medium", type: "humanoid (any race)", alignment: "any non-lawful alignment",
    ac: 15, acNote: "studded leather", hp: 65, hitDice: "10d8+20", speed: "30 ft.", walk: 30, abilities: a(15, 16, 14, 14, 11, 14),
    saves: { str: 4, dex: 5, wis: 2 }, skills: { athletics: 4, deception: 4 }, senses: "passive Perception 10", languages: "any two languages", cr: "2", xp: 450,
    traits: [],
    actions: [
      { name: "Multiattack", description: "Makes three melee attacks: two with its scimitar and one with its dagger. Or two ranged attacks with daggers." },
      { name: "Scimitar", description: "Melee weapon attack, reach 5 ft.", attackBonus: 5, damage: "1d6+3", damageType: "slashing" },
      { name: "Dagger", description: "Melee or ranged (20/60 ft.).", attackBonus: 5, damage: "1d4+3", damageType: "piercing" },
    ],
    reactions: [{ name: "Parry", description: "Adds 2 to its AC against one melee attack that would hit it (needs to see the attacker and wield a melee weapon)." }],
  },
  {
    id: "ogre", name: "Ogre", size: "Large", type: "giant", alignment: "chaotic evil",
    ac: 11, acNote: "hide armor", hp: 59, hitDice: "7d10+21", speed: "40 ft.", walk: 40, abilities: a(19, 8, 16, 5, 7, 7),
    senses: "darkvision 60 ft., passive Perception 8", languages: "Common, Giant", cr: "2", xp: 450,
    traits: [],
    actions: [
      { name: "Greatclub", description: "Melee weapon attack, reach 5 ft.", attackBonus: 6, damage: "2d8+4", damageType: "bludgeoning" },
      { name: "Javelin", description: "Melee or ranged (30/120 ft.).", attackBonus: 6, damage: "2d6+4", damageType: "piercing" },
    ],
  },
  {
    id: "priest", name: "Priest", size: "Medium", type: "humanoid (any race)", alignment: "any alignment",
    ac: 13, acNote: "chain shirt", hp: 27, hitDice: "5d8+5", speed: "30 ft.", walk: 30, abilities: a(10, 10, 12, 13, 16, 13),
    skills: { medicine: 7, persuasion: 3, religion: 4 }, senses: "passive Perception 13", languages: "any two languages", cr: "2", xp: 450,
    traits: [
      { name: "Divine Eminence", description: "As a bonus action, spends a spell slot so its melee hits deal an extra 3d6 radiant damage until the end of the turn (+1d6 per slot level above 1st)." },
      { name: "Spellcasting", description: "5th-level caster, WIS (save DC 13, +5 to hit). Cantrips: light, sacred flame, thaumaturgy. 1st (4): cure wounds, guiding bolt, sanctuary. 2nd (3): lesser restoration, spiritual weapon. 3rd (2): dispel magic, spirit guardians." },
    ],
    actions: [{ name: "Mace", description: "Melee weapon attack, reach 5 ft.", attackBonus: 2, damage: "1d6", damageType: "bludgeoning" }],
  },
  {
    id: "gelatinous-cube", name: "Gelatinous Cube", size: "Large", type: "ooze", alignment: "unaligned",
    ac: 6, hp: 84, hitDice: "8d10+40", speed: "15 ft.", walk: 15, abilities: a(14, 3, 20, 1, 6, 1),
    conditionImmunities: ["blinded", "charmed", "deafened", "exhaustion", "frightened", "prone"],
    senses: "blindsight 60 ft. (blind beyond this radius), passive Perception 8", languages: "—", cr: "2", xp: 450,
    traits: [
      { name: "Ooze Cube", description: "Fills its space. Creatures inside it are engulfed, restrained, and take 6d6 acid damage at the start of each of the cube's turns." },
      { name: "Transparent", description: "Noticing a motionless cube takes a DC 15 Perception check." },
    ],
    actions: [
      { name: "Pseudopod", description: "Melee weapon attack, reach 5 ft.", attackBonus: 4, damage: "3d6", damageType: "acid" },
      { name: "Engulf", description: "Moves through creatures in its path; each makes a DC 12 DEX save or is engulfed and takes 3d6 acid damage (pushed aside on a success)." },
    ],
  },
  {
    id: "owlbear", name: "Owlbear", size: "Large", type: "monstrosity", alignment: "unaligned",
    ac: 13, acNote: "natural armor", hp: 59, hitDice: "7d10+21", speed: "40 ft.", walk: 40, abilities: a(20, 12, 17, 3, 12, 7),
    skills: { perception: 3 }, senses: "darkvision 60 ft., passive Perception 13", languages: "—", cr: "3", xp: 700,
    traits: [{ name: "Keen Sight and Smell", description: "Advantage on Perception checks that rely on sight or smell." }],
    actions: [
      { name: "Multiattack", description: "Makes two attacks: one with its beak and one with its claws." },
      { name: "Beak", description: "Melee weapon attack, reach 5 ft.", attackBonus: 7, damage: "1d10+5", damageType: "piercing" },
      { name: "Claws", description: "Melee weapon attack, reach 5 ft.", attackBonus: 7, damage: "2d8+5", damageType: "slashing" },
    ],
  },
  {
    id: "minotaur", name: "Minotaur", size: "Large", type: "monstrosity", alignment: "chaotic evil",
    ac: 14, acNote: "natural armor", hp: 76, hitDice: "9d10+27", speed: "40 ft.", walk: 40, abilities: a(18, 11, 16, 6, 16, 9),
    skills: { perception: 7 }, senses: "darkvision 60 ft., passive Perception 17", languages: "Abyssal", cr: "3", xp: 700,
    traits: [
      { name: "Charge", description: "Moving 10+ ft. straight toward a target then hitting with gore adds 2d8 piercing; DC 14 STR save or pushed 10 ft. and knocked prone." },
      { name: "Labyrinthine Recall", description: "Perfectly recalls any path it has travelled." },
      { name: "Reckless", description: "Can gain advantage on its melee attacks this turn; attacks against it have advantage until its next turn." },
    ],
    actions: [
      { name: "Greataxe", description: "Melee weapon attack, reach 5 ft.", attackBonus: 6, damage: "2d12+4", damageType: "slashing" },
      { name: "Gore", description: "Melee weapon attack, reach 5 ft.", attackBonus: 6, damage: "2d8+4", damageType: "piercing" },
    ],
  },
  {
    id: "veteran", name: "Veteran", size: "Medium", type: "humanoid (any race)", alignment: "any alignment",
    ac: 17, acNote: "splint", hp: 58, hitDice: "9d8+18", speed: "30 ft.", walk: 30, abilities: a(16, 13, 14, 10, 11, 10),
    skills: { athletics: 5, perception: 2 }, senses: "passive Perception 12", languages: "any one language (usually Common)", cr: "3", xp: 700,
    traits: [],
    actions: [
      { name: "Multiattack", description: "Makes two longsword attacks; if it has a shortsword drawn, it can also make a shortsword attack." },
      { name: "Longsword", description: "Melee weapon attack, reach 5 ft. (1d10+3 two-handed).", attackBonus: 5, damage: "1d8+3", damageType: "slashing" },
      { name: "Shortsword", description: "Melee weapon attack, reach 5 ft.", attackBonus: 5, damage: "1d6+3", damageType: "piercing" },
      { name: "Heavy Crossbow", description: "Ranged weapon attack, range 100/400 ft.", attackBonus: 3, damage: "1d10+1", damageType: "piercing" },
    ],
  },
  {
    id: "wight", name: "Wight", size: "Medium", type: "undead", alignment: "neutral evil",
    ac: 14, acNote: "studded leather", hp: 45, hitDice: "6d8+18", speed: "30 ft.", walk: 30, abilities: a(15, 14, 16, 10, 13, 15),
    skills: { perception: 3, stealth: 4 },
    resistances: ["necrotic"], immunities: ["poison"], conditionImmunities: ["exhaustion", "poisoned"],
    senses: "darkvision 60 ft., passive Perception 13", languages: "the languages it knew in life", cr: "3", xp: 700,
    traits: [
      { name: "Damage Resistances", description: "Also resists bludgeoning, piercing and slashing from nonmagical attacks that aren't silvered." },
      { name: "Sunlight Sensitivity", description: "Disadvantage on attacks and sight-based Perception while in sunlight." },
    ],
    actions: [
      { name: "Multiattack", description: "Makes two longsword attacks or two longbow attacks; it can use Life Drain in place of one longsword attack." },
      { name: "Life Drain", description: "Melee weapon attack, reach 5 ft. The target makes a DC 13 CON save or its HP maximum drops by the damage taken until a long rest.", attackBonus: 4, damage: "1d6+2", damageType: "necrotic" },
      { name: "Longsword", description: "Melee weapon attack, reach 5 ft. (1d10+2 two-handed).", attackBonus: 4, damage: "1d8+2", damageType: "slashing" },
      { name: "Longbow", description: "Ranged weapon attack, range 150/600 ft.", attackBonus: 4, damage: "1d8+2", damageType: "piercing" },
    ],
  },
  {
    id: "troll", name: "Troll", size: "Large", type: "giant", alignment: "chaotic evil",
    ac: 15, acNote: "natural armor", hp: 84, hitDice: "8d10+40", speed: "30 ft.", walk: 30, abilities: a(18, 13, 20, 7, 9, 7),
    skills: { perception: 2 }, senses: "darkvision 60 ft., passive Perception 12", languages: "Giant", cr: "5", xp: 1800,
    traits: [
      { name: "Keen Smell", description: "Advantage on Perception checks that rely on smell." },
      { name: "Regeneration", description: "Regains 10 HP at the start of its turn. Acid or fire damage stops this on its next turn; it dies only if it starts its turn at 0 HP without regenerating." },
    ],
    actions: [
      { name: "Multiattack", description: "Makes three attacks: one with its bite and two with its claws." },
      { name: "Bite", description: "Melee weapon attack, reach 5 ft.", attackBonus: 7, damage: "1d6+4", damageType: "piercing" },
      { name: "Claw", description: "Melee weapon attack, reach 5 ft.", attackBonus: 7, damage: "2d6+4", damageType: "slashing" },
    ],
  },
  {
    id: "mage", name: "Mage", size: "Medium", type: "humanoid (any race)", alignment: "any alignment",
    ac: 12, acNote: "15 with mage armor", hp: 40, hitDice: "9d8", speed: "30 ft.", walk: 30, abilities: a(9, 14, 11, 17, 12, 11),
    saves: { int: 6, wis: 4 }, skills: { arcana: 6, history: 6 }, senses: "passive Perception 11", languages: "any four languages", cr: "6", xp: 2300,
    traits: [
      { name: "Spellcasting", description: "9th-level caster, INT (save DC 14, +6 to hit). Cantrips: fire bolt, light, mage hand, prestidigitation. 1st (4): detect magic, mage armor, magic missile, shield. 2nd (3): misty step, suggestion. 3rd (3): counterspell, fireball, fly. 4th (3): greater invisibility, ice storm. 5th (1): cone of cold." },
    ],
    actions: [{ name: "Dagger", description: "Melee or ranged (20/60 ft.).", attackBonus: 5, damage: "1d4+2", damageType: "piercing" }],
  },
  {
    id: "young-red-dragon", name: "Young Red Dragon", size: "Large", type: "dragon", alignment: "chaotic evil",
    ac: 18, acNote: "natural armor", hp: 178, hitDice: "17d10+85", speed: "40 ft., climb 40 ft., fly 80 ft.", walk: 40, abilities: a(23, 10, 21, 14, 11, 19),
    saves: { dex: 4, con: 9, wis: 4, cha: 8 }, skills: { perception: 8, stealth: 4 }, immunities: ["fire"],
    senses: "blindsight 30 ft., darkvision 120 ft., passive Perception 18", languages: "Common, Draconic", cr: "10", xp: 5900,
    traits: [],
    actions: [
      { name: "Multiattack", description: "Makes three attacks: one with its bite and two with its claws." },
      { name: "Bite", description: "Melee weapon attack, reach 10 ft.", attackBonus: 10, damage: "2d10+6", damageType: "piercing", extraDamage: { formula: "1d6", type: "fire" } },
      { name: "Claw", description: "Melee weapon attack, reach 5 ft.", attackBonus: 10, damage: "2d6+6", damageType: "slashing" },
      { name: "Fire Breath (Recharge 5–6)", description: "30-ft. cone. Each creature makes a DC 17 DEX save, taking 16d6 fire damage on a failure or half on a success.", damage: "16d6", damageType: "fire" },
    ],
  },
];

/** XP by challenge rating (SRD 5.1). */
export const XP_BY_CR: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900,
  "8": 3900, "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000, "17": 18000,
  "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000, "26": 90000,
  "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

/** Numeric CR for sorting and filtering ("1/4" → 0.25). */
export function crValue(cr: string): number {
  if (cr.includes("/")) {
    const [n, d] = cr.split("/").map(Number);
    return n! / d!;
  }
  return Number(cr) || 0;
}

/** Proficiency bonus by CR (same progression as characters). */
export function monsterProficiency(cr: string): number {
  return Math.max(2, Math.floor((Math.max(1, crValue(cr)) - 1) / 4) + 2);
}

export function getSrdMonster(id: string): SrdMonster | undefined {
  return SRD_MONSTERS.find((m) => m.id === id);
}

/** Case-insensitive search by name, type, or CR, sorted by CR then name. */
export function searchMonsters(query: string, list: SrdMonster[] = SRD_MONSTERS): SrdMonster[] {
  const q = query.trim().toLowerCase();
  return list
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q) || `cr ${m.cr}` === q || m.cr === q)
    .sort((x, y) => crValue(x.cr) - crValue(y.cr) || x.name.localeCompare(y.name));
}

// ---- Conversions -----------------------------------------------------------



export interface MonsterTokenStats {
  hp: { current: number; max: number; temp: number };
  ac: number;
  initiativeBonus: number;
  conditions: never[];
  defenses: Defenses;
  statBlock: { type: "srd"; id: string };
}

/**
 * Token stats for one copy of a monster. `hp: "roll"` rolls its hit dice (minimum 1),
 * so a group of goblins doesn't all share 7 HP; "average" uses the printed value.
 */
export function monsterTokenStats(m: SrdMonster, hp: "average" | "roll" = "average", rng?: Rng): MonsterTokenStats {
  const max = hp === "roll" ? Math.max(1, roll(m.hitDice, { rng }).total) : m.hp;
  return {
    hp: { current: max, max, temp: 0 },
    ac: m.ac,
    initiativeBonus: abilityModifier(m.abilities.dex),
    conditions: [],
    defenses: { resistances: m.resistances ?? [], vulnerabilities: m.vulnerabilities ?? [], immunities: m.immunities ?? [] },
    statBlock: { type: "srd", id: m.id },
  };
}

/**
 * A monster as editable campaign character data (kind "monster"). Printed bonuses are
 * kept exactly: proficiency is pinned to the CR's value, save/skill proficiency is
 * inferred from the printed bonus, and attacks keep their printed to-hit as an override.
 */
export function monsterToCharacterData(m: SrdMonster): CharacterData {
  const pb = monsterProficiency(m.cr);
  const mod = (ab: Ability) => abilityModifier(m.abilities[ab]);
  const saveProficiencies = ABILITIES.filter((ab) => m.saves?.[ab] !== undefined && m.saves[ab]! > mod(ab));
  const skillAbility: Record<string, Ability> = {
    acrobatics: "dex", animal_handling: "wis", arcana: "int", athletics: "str", deception: "cha", history: "int", insight: "wis",
    intimidation: "cha", investigation: "int", medicine: "wis", nature: "int", perception: "wis", performance: "cha",
    persuasion: "cha", religion: "int", sleight_of_hand: "dex", stealth: "dex", survival: "wis",
  };
  const skills: Record<string, "proficient" | "expertise"> = {};
  for (const [id, bonus] of Object.entries(m.skills ?? {})) {
    const ab = skillAbility[id];
    if (!ab) continue;
    skills[id] = bonus - mod(ab) >= 2 * pb ? "expertise" : "proficient";
  }
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const attacks = m.actions
    .filter((x) => x.attackBonus !== undefined)
    .map((x) => ({
      id: id("atk"),
      name: x.name.slice(0, 80),
      ability: "none" as const,
      proficient: false,
      magicBonus: 0,
      attackBonusOverride: x.attackBonus!,
      damage: x.damage ?? "",
      addAbilityToDamage: false,
      damageType: x.damageType ?? "",
      range: "",
      properties: x.extraDamage ? `+${x.extraDamage.formula} ${x.extraDamage.type}` : "",
    }));
  const features = [
    ...m.traits.map((t) => ({ id: id("feat"), name: t.name, source: "other" as const, description: t.description, uses: null })),
    ...m.actions.map((x) => ({ id: id("feat"), name: `Action: ${x.name}`, source: "other" as const, description: x.description, uses: null })),
    ...(m.reactions ?? []).map((t) => ({ id: id("feat"), name: `Reaction: ${t.name}`, source: "other" as const, description: t.description, uses: null })),
  ].map((f) => ({ ...f, name: f.name.slice(0, 100) }));
  return characterDataSchema.parse({
    species: `${m.size} ${m.type}`.slice(0, 60),
    alignment: m.alignment.slice(0, 40),
    abilities: m.abilities,
    saveProficiencies,
    skills,
    armorClass: m.ac,
    speed: m.walk,
    hp: { max: m.hp, current: m.hp, temp: 0 },
    defenses: { resistances: m.resistances ?? [], vulnerabilities: m.vulnerabilities ?? [], immunities: m.immunities ?? [] },
    attacks,
    features,
    notes: {
      description: [
        `${m.size} ${m.type}, ${m.alignment}`,
        `AC ${m.ac}${m.acNote ? ` (${m.acNote})` : ""} · HP ${m.hp} (${m.hitDice}) · Speed ${m.speed}`,
        `Senses: ${m.senses}`,
        `Languages: ${m.languages}`,
        m.conditionImmunities?.length ? `Condition immunities: ${m.conditionImmunities.join(", ")}` : "",
        `Challenge ${m.cr} (${m.xp} XP)`,
        "Source: SRD 5.1 (CC-BY-4.0)",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    overrides: { proficiencyBonus: pb },
  });
}

/** Total XP of a list of monsters with counts (no difficulty multiplier). */
export function encounterXp(entries: Array<{ xp: number; count: number }>): number {
  return entries.reduce((sum, e) => sum + Math.max(0, e.xp) * Math.max(0, Math.floor(e.count)), 0);
}
