/**
 * Character sheet import: the shape an extractor (AI reading a PDF/photo) returns,
 * and the pure mapping from that draft to validated CharacterData. The user reviews
 * and edits the draft before it is mapped and saved, so nothing extracted is trusted
 * blindly; the mapping clamps every number and drops anything that doesn't fit.
 */
import { z } from "zod";
import { ABILITIES, type Ability, type RulesetDefinition } from "../rulesets/types.js";
import { validateFormula } from "../dice/roller.js";
import { characterDataSchema, type CharacterData } from "./schema.js";

const nInt = z.number().int().nullable();
const nStr = z.string().nullable();

/**
 * Deliberately loose (no numeric bounds) so a model can report what it sees;
 * `sheetToCharacterData` enforces the real limits.
 */
export const extractedSheetSchema = z.object({
  name: z.string(),
  playerName: nStr,
  species: nStr,
  background: nStr,
  alignment: nStr,
  classes: z.array(z.object({ name: z.string(), subclass: nStr, level: z.number().int() })),
  abilities: z.object({ str: nInt, dex: nInt, con: nInt, int: nInt, wis: nInt, cha: nInt }),
  savingThrowProficiencies: z.array(z.enum(ABILITIES)),
  skillProficiencies: z.array(z.object({ skill: z.string(), level: z.enum(["proficient", "expertise"]) })),
  armorClass: nInt,
  maxHp: nInt,
  currentHp: nInt,
  tempHp: nInt,
  speed: nInt,
  xp: nInt,
  attacks: z.array(z.object({ name: z.string(), attackBonus: nInt, damage: nStr, damageType: nStr })),
  features: z.array(z.object({ name: z.string(), description: z.string() })),
  spells: z.array(z.object({ name: z.string(), level: z.number().int() })),
  inventory: z.array(z.object({ name: z.string(), quantity: nInt })),
  currency: z.object({ cp: nInt, sp: nInt, ep: nInt, gp: nInt, pp: nInt }),
  notes: z.object({ personality: nStr, ideals: nStr, bonds: nStr, flaws: nStr, backstory: nStr }),
  /** Field paths the reader wasn't sure about (e.g. "abilities.wis", "maxHp"); the review UI highlights them. */
  uncertainFields: z.array(z.string()),
  /** Anything the user should know (illegible areas, values that didn't add up). */
  warnings: z.array(z.string()),
});

export type ExtractedSheet = z.infer<typeof extractedSheetSchema>;

export function emptyExtractedSheet(name = ""): ExtractedSheet {
  return {
    name,
    playerName: null,
    species: null,
    background: null,
    alignment: null,
    classes: [],
    abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null },
    savingThrowProficiencies: [],
    skillProficiencies: [],
    armorClass: null,
    maxHp: null,
    currentHp: null,
    tempHp: null,
    speed: null,
    xp: null,
    attacks: [],
    features: [],
    spells: [],
    inventory: [],
    currency: { cp: null, sp: null, ep: null, gp: null, pp: null },
    notes: { personality: null, ideals: null, bonds: null, flaws: null, backstory: null },
    uncertainFields: [],
    warnings: [],
  };
}

const HIT_DIE: Record<string, 6 | 8 | 10 | 12> = {
  barbarian: 12,
  fighter: 10,
  paladin: 10,
  ranger: 10,
  sorcerer: 6,
  wizard: 6,
};

const clamp = (v: number | null | undefined, min: number, max: number, fallback: number) =>
  v === null || v === undefined || !Number.isFinite(v) ? fallback : Math.min(max, Math.max(min, Math.round(v)));
const text = (v: string | null | undefined, max: number) => (v ?? "").trim().slice(0, max);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export interface SheetMapping {
  data: CharacterData;
  name: string;
  /** Things the mapping had to drop or adjust, for the user. */
  notes: string[];
}

/** Maps a reviewed draft to CharacterData for `ruleset`. Never throws on odd input. */
export function sheetToCharacterData(sheet: ExtractedSheet, ruleset: RulesetDefinition): SheetMapping {
  const notes: string[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;

  const classes = sheet.classes
    .filter((c) => c.name.trim())
    .slice(0, 10)
    .map((c) => ({
      name: text(c.name, 60),
      subclass: text(c.subclass, 60),
      level: clamp(c.level, 1, ruleset.maxLevel, 1),
      hitDie: HIT_DIE[norm(c.name)] ?? 8,
    }));

  const abilities = Object.fromEntries(
    ABILITIES.map((a) => [a, clamp(sheet.abilities[a], ruleset.abilityScore.min, ruleset.abilityScore.max, 10)]),
  ) as Record<Ability, number>;
  for (const a of ABILITIES) if (sheet.abilities[a] === null) notes.push(`${a.toUpperCase()} wasn't read; set to 10`);

  const skills: Record<string, "proficient" | "expertise"> = {};
  for (const s of sheet.skillProficiencies) {
    const def = ruleset.skills.find((k) => norm(k.name) === norm(s.skill) || k.id === s.skill);
    if (def) skills[def.id] = s.level;
    else notes.push(`Unknown skill "${s.skill}" skipped`);
  }

  const attacks = sheet.attacks
    .filter((a) => a.name.trim())
    .slice(0, 50)
    .map((a) => {
      let damage = text(a.damage, 100).replace(/\s+/g, "");
      if (damage && validateFormula(damage) !== null) {
        notes.push(`Damage "${a.damage}" for ${a.name} isn't a dice formula; left blank`);
        damage = "";
      }
      return {
        id: id("atk"),
        name: text(a.name, 80),
        ability: "none" as const,
        proficient: false,
        magicBonus: 0,
        // The sheet's printed bonus is authoritative; keep it as an override.
        attackBonusOverride: a.attackBonus === null ? null : clamp(a.attackBonus, -50, 50, 0),
        damage,
        // Printed damage usually already includes the modifier.
        addAbilityToDamage: false,
        damageType: text(a.damageType, 30).toLowerCase(),
        range: "",
        properties: "",
      };
    });

  const maxHp = clamp(sheet.maxHp, 0, 10000, 1);
  const raw = {
    playerName: text(sheet.playerName, 60),
    classes,
    species: text(sheet.species, 60),
    background: text(sheet.background, 60),
    alignment: text(sheet.alignment, 40),
    xp: clamp(sheet.xp, 0, 10_000_000, 0),
    abilities,
    saveProficiencies: [...new Set(sheet.savingThrowProficiencies)],
    skills,
    armorClass: clamp(sheet.armorClass, 0, 50, 10),
    speed: clamp(sheet.speed, 0, 1000, 30),
    hp: { max: maxHp, current: clamp(sheet.currentHp, -10000, maxHp, maxHp), temp: clamp(sheet.tempHp, 0, 10000, 0) },
    attacks,
    features: sheet.features
      .filter((f) => f.name.trim())
      .slice(0, 200)
      .map((f) => ({ id: id("feat"), name: text(f.name, 100), source: "other" as const, description: text(f.description, 5000), uses: null })),
    spellcasting: {
      ability: "none" as const,
      slots: Array.from({ length: 9 }, () => ({ max: 0, used: 0 })),
      spells: sheet.spells
        .filter((s) => s.name.trim())
        .slice(0, 300)
        .map((s) => ({ id: id("spell"), name: text(s.name, 100), level: clamp(s.level, 0, 9, 0), school: "", prepared: false, concentration: false, ritual: false, notes: "" })),
    },
    inventory: sheet.inventory
      .filter((i) => i.name.trim())
      .slice(0, 500)
      .map((i) => ({ id: id("item"), name: text(i.name, 100), category: "gear" as const, quantity: clamp(i.quantity, 0, 100000, 1), weight: 0, equipped: false, notes: "" })),
    currency: {
      cp: clamp(sheet.currency.cp, 0, 1e9, 0),
      sp: clamp(sheet.currency.sp, 0, 1e9, 0),
      ep: clamp(sheet.currency.ep, 0, 1e9, 0),
      gp: clamp(sheet.currency.gp, 0, 1e9, 0),
      pp: clamp(sheet.currency.pp, 0, 1e9, 0),
    },
    notes: {
      personality: text(sheet.notes.personality, 20000),
      ideals: text(sheet.notes.ideals, 20000),
      bonds: text(sheet.notes.bonds, 20000),
      flaws: text(sheet.notes.flaws, 20000),
      backstory: text(sheet.notes.backstory, 20000),
    },
  };
  return { data: characterDataSchema.parse(raw), name: text(sheet.name, 100) || "Imported character", notes };
}
