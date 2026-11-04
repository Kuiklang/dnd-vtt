import { z } from "zod";
import { ABILITIES } from "../rulesets/types.js";
import { validateFormula } from "../dice/roller.js";

/**
 * Character data stored as validated JSON (JSONB in Postgres). Versioned with
 * `schemaVersion` so imports/exports and stored rows can be migrated forward.
 *
 * Values are *inputs*; derived numbers (modifiers, saves, skills, DCs…) are computed
 * by `deriveCharacter()` from the campaign's ruleset. Explicit `overrides` let a
 * player or DM pin a value; derived output reports whether a number came from
 * calculation or from an override.
 */

export const CHARACTER_SCHEMA_VERSION = 1;

const shortText = (max = 120) => z.string().trim().max(max);
const longText = (max = 20000) => z.string().max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

const formula = z
  .string()
  .trim()
  .max(100)
  .refine((f) => f === "" || validateFormula(f) === null, { message: "Invalid dice formula" });

export const abilityIdSchema = z.enum(ABILITIES);
export const proficiencyLevelSchema = z.enum(["none", "half", "proficient", "expertise"]);
export type ProficiencyLevel = z.infer<typeof proficiencyLevelSchema>;

export const classEntrySchema = z.object({
  name: shortText(60).min(1),
  subclass: shortText(60).default(""),
  level: int(1, 40),
  hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]).default(8),
});

export const attackSchema = z.object({
  id: shortText(40).min(1),
  name: shortText(80).min(1),
  ability: z.union([abilityIdSchema, z.literal("spell"), z.literal("none")]).default("str"),
  proficient: z.boolean().default(true),
  magicBonus: int(-20, 20).default(0),
  /** Flat attack bonus override; null = computed. */
  attackBonusOverride: int(-50, 50).nullable().default(null),
  damage: formula.default(""),
  /** Add the ability modifier to damage. */
  addAbilityToDamage: z.boolean().default(true),
  damageType: shortText(30).default(""),
  range: shortText(40).default(""),
  properties: shortText(200).default(""),
});

export const featureSchema = z.object({
  id: shortText(40).min(1),
  name: shortText(100).min(1),
  source: z.enum(["class", "subclass", "species", "feat", "background", "homebrew", "other"]).default("other"),
  description: longText(5000).default(""),
  uses: z.object({ max: int(0, 99), used: int(0, 99) }).nullable().default(null),
});

export const spellSchema = z.object({
  id: shortText(40).min(1),
  name: shortText(100).min(1),
  level: int(0, 9),
  school: shortText(30).default(""),
  prepared: z.boolean().default(false),
  concentration: z.boolean().default(false),
  ritual: z.boolean().default(false),
  notes: longText(2000).default(""),
  /** SRD library id this entry came from (Phase 7); lets the table resolve a cast. */
  srdId: shortText(60).default(""),
});

export const itemSchema = z.object({
  id: shortText(40).min(1),
  name: shortText(100).min(1),
  category: z
    .enum(["weapon", "armor", "shield", "potion", "consumable", "magic", "quest", "gear", "other"])
    .default("gear"),
  quantity: int(0, 100000).default(1),
  weight: z.number().min(0).max(100000).default(0),
  equipped: z.boolean().default(false),
  notes: longText(2000).default(""),
});

export const conditionEntrySchema = z.object({
  id: shortText(40).min(1),
  level: int(1, 20).optional(),
  source: shortText(80).default(""),
  /** Remaining duration in rounds; null = indefinite. */
  durationRounds: int(0, 100000).nullable().default(null),
});

const damageTypeList = z.array(shortText(30).min(1)).max(20).default([]);
export const defensesSchema = z.object({
  resistances: damageTypeList,
  vulnerabilities: damageTypeList,
  immunities: damageTypeList,
});
export type Defenses = z.infer<typeof defensesSchema>;

const slotSchema = z.object({ max: int(0, 20).default(0), used: int(0, 20).default(0) });

export const characterDataSchema = z
  .object({
    schemaVersion: z.literal(CHARACTER_SCHEMA_VERSION).default(CHARACTER_SCHEMA_VERSION),
    playerName: shortText(60).default(""),
    classes: z.array(classEntrySchema).max(10).default([]),
    species: shortText(60).default(""),
    background: shortText(60).default(""),
    alignment: shortText(40).default(""),
    xp: int(0, 10_000_000).default(0),
    portraitUrl: z.union([z.literal(""), z.string().url().max(500).regex(/^https:\/\//, "Portrait must be an https URL")]).default(""),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#b8860b"),
    abilities: z
      .object(Object.fromEntries(ABILITIES.map((a) => [a, int(1, 30).default(10)])) as Record<
        (typeof ABILITIES)[number],
        z.ZodDefault<z.ZodNumber>
      >)
      .default({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
    saveProficiencies: z.array(abilityIdSchema).max(6).default([]),
    skills: z.record(z.string().max(40), proficiencyLevelSchema).default({}),
    /** Advantage/disadvantage defaults per skill (e.g. armour imposing stealth disadvantage). */
    skillRollModes: z.record(z.string().max(40), z.enum(["advantage", "disadvantage"])).default({}),
    armorClass: int(0, 50).default(10),
    speed: int(0, 1000).default(30),
    hp: z
      .object({ max: int(0, 10000).default(1), current: int(-10000, 10000).default(1), temp: int(0, 10000).default(0) })
      .default({ max: 1, current: 1, temp: 0 }),
    hitDiceUsed: int(0, 40).default(0),
    deathSaves: z.object({ successes: int(0, 3).default(0), failures: int(0, 3).default(0) }).default({ successes: 0, failures: 0 }),
    inspiration: z.boolean().default(false),
    conditions: z.array(conditionEntrySchema).max(30).default([]),
    /** Damage types (ruleset ids) this creature resists / is vulnerable to / ignores. */
    defenses: defensesSchema.default({ resistances: [], vulnerabilities: [], immunities: [] }),
    attacks: z.array(attackSchema).max(50).default([]),
    features: z.array(featureSchema).max(200).default([]),
    spellcasting: z
      .object({
        ability: z.union([abilityIdSchema, z.literal("none")]).default("none"),
        slots: z.array(slotSchema).length(9).default(Array.from({ length: 9 }, () => ({ max: 0, used: 0 }))),
        spells: z.array(spellSchema).max(300).default([]),
      })
      .default({ ability: "none", slots: Array.from({ length: 9 }, () => ({ max: 0, used: 0 })), spells: [] }),
    inventory: z.array(itemSchema).max(500).default([]),
    currency: z
      .object({ cp: int(0, 1e9).default(0), sp: int(0, 1e9).default(0), ep: int(0, 1e9).default(0), gp: int(0, 1e9).default(0), pp: int(0, 1e9).default(0) })
      .default({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }),
    notes: z
      .object({
        description: longText().default(""),
        personality: longText().default(""),
        ideals: longText().default(""),
        bonds: longText().default(""),
        flaws: longText().default(""),
        backstory: longText().default(""),
        personal: longText().default(""),
        quests: longText().default(""),
        goals: longText().default(""),
        relationships: longText().default(""),
      })
      .default({ description: "", personality: "", ideals: "", bonds: "", flaws: "", backstory: "", personal: "", quests: "", goals: "", relationships: "" }),
    /** Pinned values that replace computed ones (DM/player override). */
    overrides: z
      .object({
        proficiencyBonus: int(0, 20).optional(),
        initiative: int(-20, 50).optional(),
        passivePerception: int(0, 60).optional(),
        spellSaveDc: int(0, 50).optional(),
        spellAttackBonus: int(-20, 50).optional(),
      })
      .default({}),
  })
  .strict();

export type CharacterData = z.infer<typeof characterDataSchema>;
export type CharacterDataInput = z.input<typeof characterDataSchema>;

export const characterKindSchema = z.enum(["pc", "npc", "monster"]);
export type CharacterKind = z.infer<typeof characterKindSchema>;

export function emptyCharacterData(): CharacterData {
  return characterDataSchema.parse({});
}

/**
 * Migrates raw (possibly older) character JSON to the current schema version.
 * Throws a ZodError with readable issues if the data is invalid.
 */
export function migrateCharacterData(raw: unknown): CharacterData {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Character data must be an object");
  }
  const obj = { ...(raw as Record<string, unknown>) };
  const version = obj.schemaVersion ?? CHARACTER_SCHEMA_VERSION;
  if (typeof version !== "number" || version > CHARACTER_SCHEMA_VERSION) {
    throw new Error(`Unsupported character schema version: ${String(version)}`);
  }
  // Future: `if (version < 2) obj = v1ToV2(obj)` etc.
  obj.schemaVersion = CHARACTER_SCHEMA_VERSION;
  return characterDataSchema.parse(obj);
}

/** Portable export envelope (character JSON import/export). */
export const characterExportSchema = z.object({
  format: z.literal("vtt-character"),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  character: z.object({
    name: shortText(100).min(1),
    kind: characterKindSchema,
    rulesetId: shortText(80),
    data: z.unknown(),
  }),
});
export type CharacterExport = z.infer<typeof characterExportSchema>;
