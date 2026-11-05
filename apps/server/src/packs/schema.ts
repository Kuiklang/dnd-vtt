import { z } from "zod";
import { AMBIENT_LIGHTS, GRID_TYPES, HP_VISIBILITY, MAX_SIGHT_FT, TOKEN_LAYERS, TOKEN_SHAPES } from "@vtt/rules";
import { itemSchema } from "@vtt/rules";

/**
 * Campaign pack: a .zip holding `campaign.json` plus the images it names. Importing
 * one creates a brand-new campaign owned by the importer, with scenes, tokens,
 * NPC/monster sheets, journal entries, encounters and random tables already set up.
 *
 * Ids inside the pack (`id`, `statBlock`, `map`...) are pack-local labels; the server
 * gives every row a fresh uuid.
 */
export const PACK_FORMAT = "vtt-campaign-pack";
export const PACK_VERSION = 1;

const label = z.string().trim().min(1).max(80);
const text = (max: number) => z.string().max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const ability = z.number().int().min(1).max(30);

const actionSchema = z.object({
  name: text(100).min(1),
  description: text(2000).default(""),
  attackBonus: z.number().int().min(-10).max(30).optional(),
  damage: text(60).optional(),
  damageType: text(40).optional(),
  extraDamage: z.object({ formula: text(40), type: text(40) }).optional(),
});
const traitSchema = z.object({ name: text(100).min(1), description: text(2000).default("") });

/** Same shape as the SRD bestiary entries, so the existing monster → sheet code applies. */
export const packMonsterSchema = z.object({
  size: z.enum(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]).default("Medium"),
  type: text(80).default(""),
  alignment: text(60).default(""),
  ac: z.number().int().min(0).max(40),
  acNote: text(80).optional(),
  hp: z.number().int().min(0).max(5000),
  hitDice: text(40).default(""),
  speed: text(120).default("30 ft."),
  walk: z.number().int().min(0).max(300).default(30),
  abilities: z.object({ str: ability, dex: ability, con: ability, int: ability, wis: ability, cha: ability }),
  saves: z.partialRecord(z.enum(["str", "dex", "con", "int", "wis", "cha"]), z.number().int()).optional(),
  skills: z.record(z.string().max(40), z.number().int()).optional(),
  resistances: z.array(text(30)).max(20).optional(),
  immunities: z.array(text(30)).max(20).optional(),
  vulnerabilities: z.array(text(30)).max(20).optional(),
  conditionImmunities: z.array(text(30)).max(20).optional(),
  senses: text(200).default(""),
  languages: text(200).default(""),
  cr: z.string().regex(/^(0|1\/8|1\/4|1\/2|[1-9]|[12][0-9]|30)$/).default("0"),
  xp: z.number().int().min(0).max(200000).default(0),
  traits: z.array(traitSchema).max(40).default([]),
  actions: z.array(actionSchema).max(40).default([]),
  reactions: z.array(traitSchema).max(10).optional(),
});
export type PackMonster = z.infer<typeof packMonsterSchema>;

export const packStatBlockSchema = z.object({
  id: label,
  /** "npc" for named characters and props (chests), "monster" for generic creatures. */
  kind: z.enum(["npc", "monster"]),
  name: text(80).min(1),
  playerVisible: z.boolean().default(false),
  monster: packMonsterSchema,
  /** Extra DM notes appended to the sheet (tactics, where it's found...). */
  notes: text(6000).default(""),
  inventory: z.array(itemSchema.omit({ id: true }).partial({ category: true, quantity: true, weight: true, equipped: true, notes: true })).max(100).default([]),
  currency: z
    .object({ cp: z.number().int().min(0), sp: z.number().int().min(0), ep: z.number().int().min(0), gp: z.number().int().min(0), pp: z.number().int().min(0) })
    .partial()
    .default({}),
});

const lightSchema = z.object({ bright: z.number().min(0).max(MAX_SIGHT_FT), dim: z.number().min(0).max(MAX_SIGHT_FT), color: hex });

export const packTokenSchema = z.object({
  name: text(60).min(1),
  /** Stat block to use. Without one the token is a plain marker. */
  statBlock: label.optional(),
  /**
   * true: the token is the sheet itself (shared HP across scenes; used for unique NPCs
   * and chests whose inventory the DM hands out). false: an independent copy with its
   * own HP that only references the sheet (used for groups of monsters).
   */
  linked: z.boolean().default(false),
  image: label.optional(),
  /** Top-left grid cell, 0-based [column, row]. Fractions are allowed. */
  cell: z.tuple([z.number().min(-1000).max(10000), z.number().min(-1000).max(10000)]),
  size: z.number().min(0.25).max(10).default(1),
  layer: z.enum(TOKEN_LAYERS).default("tokens"),
  shape: z.enum(TOKEN_SHAPES).default("circle"),
  color: hex.default("#7d241c"),
  borderColor: hex.default("#d9b14f"),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  showName: z.boolean().default(true),
  hpVisibility: z.enum(HP_VISIBILITY).default("gm"),
  light: lightSchema.nullable().default(null),
});

export const packSceneSchema = z.object({
  name: text(100).min(1),
  map: label.optional(),
  backgroundColor: hex.default("#1a1714"),
  /** Defaults to the map's pixel size, or `cols × rows` cells when there's no map. */
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  cols: z.number().int().min(4).max(200).optional(),
  rows: z.number().int().min(4).max(200).optional(),
  grid: z
    .object({
      type: z.enum(GRID_TYPES),
      size: z.number().min(10).max(500),
      offsetX: z.number().min(-500).max(500),
      offsetY: z.number().min(-500).max(500),
      color: hex,
      opacity: z.number().min(0).max(1),
      unitsPerCell: z.number().min(0.1).max(10000),
      unit: z.string().min(1).max(12),
    })
    .partial()
    .default({}),
  fogEnabled: z.boolean().default(false),
  vision: z.object({ enabled: z.boolean(), ambient: z.enum(AMBIENT_LIGHTS) }).default({ enabled: false, ambient: "bright" }),
  dmNotes: text(20000).default(""),
  tokens: z.array(packTokenSchema).max(500).default([]),
});

export const packSchema = z.object({
  format: z.literal(PACK_FORMAT),
  version: z.literal(PACK_VERSION),
  campaign: z.object({
    name: text(100).min(1),
    description: text(2000).default(""),
    setting: text(100).default(""),
    houseRules: text(20000).default(""),
    rulesetId: z.string().default("dnd5e-2014"),
    maxPlayers: z.number().int().min(1).max(12).default(6),
  }),
  assets: z
    .array(z.object({ id: label, file: z.string().min(1).max(300), kind: z.enum(["map", "token", "portrait", "handout", "cover"]) }))
    .max(300)
    .default([]),
  statBlocks: z.array(packStatBlockSchema).max(500).default([]),
  scenes: z.array(packSceneSchema).max(200).default([]),
  journal: z
    .array(
      z.object({
        title: text(120).min(1),
        body: text(100_000).default(""),
        folder: text(60).default(""),
        visibility: z.enum(["gm", "all"]).default("gm"),
        image: label.optional(),
        pinned: z.boolean().default(false),
      }),
    )
    .max(1000)
    .default([]),
  encounters: z
    .array(
      z.object({
        name: text(100).min(1),
        notes: text(5000).default(""),
        entries: z.array(z.object({ statBlock: label, count: z.number().int().min(1).max(100) })).min(1).max(50),
      }),
    )
    .max(500)
    .default([]),
  tables: z
    .array(
      z.object({
        name: text(100).min(1),
        formula: z.string().max(20),
        entries: z.array(z.object({ min: z.number().int(), max: z.number().int(), text: text(1000).min(1) })).min(1).max(200),
      }),
    )
    .max(200)
    .default([]),
});
export type CampaignPack = z.infer<typeof packSchema>;
