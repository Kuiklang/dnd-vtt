/**
 * A curated set of spells from the System Reference Document 5.1 (CC-BY-4.0,
 * Wizards of the Coast). Only the mechanics a table needs to resolve a cast are
 * stored; descriptions are short summaries. Spells outside the SRD (e.g. Hex,
 * Toll the Dead) are deliberately absent.
 */

import type { Ability } from "../rulesets/types.js";

export const AOE_SHAPES = ["sphere", "cone", "line", "cube", "cylinder"] as const;
export type AoeShape = (typeof AOE_SHAPES)[number];

export interface SpellDamagePart {
  dice: string;
  type: string;
}

export interface SrdSpell {
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  classes: string[];
  /** Spell attack roll. */
  attack?: "melee" | "ranged";
  /** Saving throw the target makes against the caster's DC. */
  save?: Ability;
  /** Half damage on a successful save (most damaging save spells). */
  halfOnSave?: boolean;
  damage?: SpellDamagePart[];
  heal?: { dice: string; addModifier: boolean };
  /** Extra dice per slot level above the spell's level (damage, or healing for heal spells). */
  upcast?: { dice: string; perLevels?: number };
  /** Cantrip damage grows at character levels 5, 11 and 17. */
  cantripScaling?: boolean;
  /** Several separate attacks/missiles (Scorching Ray, Magic Missile, Eldritch Blast). */
  beams?: { count: number; perUpcastLevel?: number; cantripScaling?: boolean };
  area?: { shape: AoeShape; sizeFt: number; widthFt?: number };
  summary: string;
}

const W = "wizard";
const S = "sorcerer";
const C = "cleric";
const D = "druid";
const B = "bard";
const K = "warlock";
const P = "paladin";
const R = "ranger";

const sp = (s: SrdSpell) => s;

export const SRD_SPELLS: SrdSpell[] = [
  // ---- Cantrips ----
  sp({ id: "acid-splash", name: "Acid Splash", level: 0, school: "conjuration", castingTime: "1 action", range: "60 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], save: "dex", damage: [{ dice: "1d6", type: "acid" }], cantripScaling: true, summary: "One creature, or two within 5 ft of each other, make a Dex save or take acid damage." }),
  sp({ id: "chill-touch", name: "Chill Touch", level: 0, school: "necromancy", castingTime: "1 action", range: "120 ft", components: "V, S", duration: "1 round", concentration: false, ritual: false, classes: [S, K, W], attack: "ranged", damage: [{ dice: "1d8", type: "necrotic" }], cantripScaling: true, summary: "Ghostly hand; target can't regain hit points until your next turn." }),
  sp({ id: "eldritch-blast", name: "Eldritch Blast", level: 0, school: "evocation", castingTime: "1 action", range: "120 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [K], attack: "ranged", damage: [{ dice: "1d10", type: "force" }], beams: { count: 1, cantripScaling: true }, summary: "A beam of crackling energy; more beams at levels 5, 11 and 17." }),
  sp({ id: "fire-bolt", name: "Fire Bolt", level: 0, school: "evocation", castingTime: "1 action", range: "120 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], attack: "ranged", damage: [{ dice: "1d10", type: "fire" }], cantripScaling: true, summary: "Hurl a mote of fire; ignites unattended flammable objects." }),
  sp({ id: "guidance", name: "Guidance", level: 0, school: "divination", castingTime: "1 action", range: "Touch", components: "V, S", duration: "1 minute", concentration: true, ritual: false, classes: [C, D], summary: "Willing creature adds 1d4 to one ability check of its choice." }),
  sp({ id: "light", name: "Light", level: 0, school: "evocation", castingTime: "1 action", range: "Touch", components: "V, M", duration: "1 hour", concentration: false, ritual: false, classes: [B, C, S, W], summary: "An object sheds bright light in a 20-ft radius and dim light 20 ft further." }),
  sp({ id: "mage-hand", name: "Mage Hand", level: 0, school: "conjuration", castingTime: "1 action", range: "30 ft", components: "V, S", duration: "1 minute", concentration: false, ritual: false, classes: [B, S, K, W], summary: "A spectral hand manipulates objects up to 10 lb." }),
  sp({ id: "poison-spray", name: "Poison Spray", level: 0, school: "conjuration", castingTime: "1 action", range: "10 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [D, S, K, W], save: "con", damage: [{ dice: "1d12", type: "poison" }], cantripScaling: true, summary: "A puff of noxious gas; Con save or take poison damage." }),
  sp({ id: "produce-flame", name: "Produce Flame", level: 0, school: "conjuration", castingTime: "1 action", range: "Self", components: "V, S", duration: "10 minutes", concentration: false, ritual: false, classes: [D], attack: "ranged", damage: [{ dice: "1d8", type: "fire" }], cantripScaling: true, summary: "A flame in your hand lights the area; throw it at a creature within 30 ft." }),
  sp({ id: "ray-of-frost", name: "Ray of Frost", level: 0, school: "evocation", castingTime: "1 action", range: "60 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], attack: "ranged", damage: [{ dice: "1d8", type: "cold" }], cantripScaling: true, summary: "A frigid beam; target's speed drops by 10 ft until your next turn." }),
  sp({ id: "sacred-flame", name: "Sacred Flame", level: 0, school: "evocation", castingTime: "1 action", range: "60 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [C], save: "dex", damage: [{ dice: "1d8", type: "radiant" }], cantripScaling: true, summary: "Flame descends on a creature; no benefit from cover against the save." }),
  sp({ id: "shocking-grasp", name: "Shocking Grasp", level: 0, school: "evocation", castingTime: "1 action", range: "Touch", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], attack: "melee", damage: [{ dice: "1d8", type: "lightning" }], cantripScaling: true, summary: "Advantage against metal armour; target can't take reactions until its next turn." }),
  sp({ id: "spare-the-dying", name: "Spare the Dying", level: 0, school: "necromancy", castingTime: "1 action", range: "Touch", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [C], summary: "A living creature at 0 hit points becomes stable." }),
  sp({ id: "vicious-mockery", name: "Vicious Mockery", level: 0, school: "enchantment", castingTime: "1 action", range: "60 ft", components: "V", duration: "Instantaneous", concentration: false, ritual: false, classes: [B], save: "wis", damage: [{ dice: "1d4", type: "psychic" }], cantripScaling: true, summary: "Insults laced with magic; on a failed save the target has disadvantage on its next attack." }),

  // ---- 1st level ----
  sp({ id: "bless", name: "Bless", level: 1, school: "enchantment", castingTime: "1 action", range: "30 ft", components: "V, S, M", duration: "1 minute", concentration: true, ritual: false, classes: [C, P], summary: "Up to three creatures add 1d4 to attack rolls and saving throws." }),
  sp({ id: "burning-hands", name: "Burning Hands", level: 1, school: "evocation", castingTime: "1 action", range: "Self (15-ft cone)", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], save: "dex", halfOnSave: true, damage: [{ dice: "3d6", type: "fire" }], upcast: { dice: "1d6" }, area: { shape: "cone", sizeFt: 15 }, summary: "A thin sheet of flames shoots from your fingertips." }),
  sp({ id: "charm-person", name: "Charm Person", level: 1, school: "enchantment", castingTime: "1 action", range: "30 ft", components: "V, S", duration: "1 hour", concentration: false, ritual: false, classes: [B, D, S, K, W], save: "wis", summary: "A humanoid regards you as a friendly acquaintance; advantage on the save if you're fighting it." }),
  sp({ id: "cure-wounds", name: "Cure Wounds", level: 1, school: "evocation", castingTime: "1 action", range: "Touch", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [B, C, D, P, R], heal: { dice: "1d8", addModifier: true }, upcast: { dice: "1d8" }, summary: "A creature you touch regains hit points." }),
  sp({ id: "detect-magic", name: "Detect Magic", level: 1, school: "divination", castingTime: "1 action", range: "Self", components: "V, S", duration: "10 minutes", concentration: true, ritual: true, classes: [B, C, D, P, R, S, W], summary: "Sense magic within 30 ft and see its aura and school." }),
  sp({ id: "faerie-fire", name: "Faerie Fire", level: 1, school: "evocation", castingTime: "1 action", range: "60 ft", components: "V", duration: "1 minute", concentration: true, ritual: false, classes: [B, D], save: "dex", area: { shape: "cube", sizeFt: 20 }, summary: "Creatures that fail are outlined in light: attacks against them have advantage." }),
  sp({ id: "guiding-bolt", name: "Guiding Bolt", level: 1, school: "evocation", castingTime: "1 action", range: "120 ft", components: "V, S", duration: "1 round", concentration: false, ritual: false, classes: [C], attack: "ranged", damage: [{ dice: "4d6", type: "radiant" }], upcast: { dice: "1d6" }, summary: "The next attack roll against the target before your next turn has advantage." }),
  sp({ id: "healing-word", name: "Healing Word", level: 1, school: "evocation", castingTime: "1 bonus action", range: "60 ft", components: "V", duration: "Instantaneous", concentration: false, ritual: false, classes: [B, C, D], heal: { dice: "1d4", addModifier: true }, upcast: { dice: "1d4" }, summary: "A creature you can see regains hit points." }),
  sp({ id: "inflict-wounds", name: "Inflict Wounds", level: 1, school: "necromancy", castingTime: "1 action", range: "Touch", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [C], attack: "melee", damage: [{ dice: "3d10", type: "necrotic" }], upcast: { dice: "1d10" }, summary: "Melee spell attack that deals necrotic damage." }),
  sp({ id: "mage-armor", name: "Mage Armor", level: 1, school: "abjuration", castingTime: "1 action", range: "Touch", components: "V, S, M", duration: "8 hours", concentration: false, ritual: false, classes: [S, W], summary: "An unarmoured creature's base AC becomes 13 + its Dex modifier." }),
  sp({ id: "magic-missile", name: "Magic Missile", level: 1, school: "evocation", castingTime: "1 action", range: "120 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], damage: [{ dice: "1d4+1", type: "force" }], beams: { count: 3, perUpcastLevel: 1 }, summary: "Three glowing darts that always hit (one more per slot level above 1st)." }),
  sp({ id: "shield", name: "Shield", level: 1, school: "abjuration", castingTime: "1 reaction", range: "Self", components: "V, S", duration: "1 round", concentration: false, ritual: false, classes: [S, W], summary: "+5 AC until the start of your next turn, and no damage from Magic Missile." }),
  sp({ id: "sleep", name: "Sleep", level: 1, school: "enchantment", castingTime: "1 action", range: "90 ft", components: "V, S, M", duration: "1 minute", concentration: false, ritual: false, classes: [B, S, W], area: { shape: "sphere", sizeFt: 20 }, summary: "Roll 5d8 (+2d8 per slot level above 1st); creatures fall asleep in order of lowest hit points." }),
  sp({ id: "thunderwave", name: "Thunderwave", level: 1, school: "evocation", castingTime: "1 action", range: "Self (15-ft cube)", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [B, D, S, W], save: "con", halfOnSave: true, damage: [{ dice: "2d8", type: "thunder" }], upcast: { dice: "1d8" }, area: { shape: "cube", sizeFt: 15 }, summary: "A wave of force; creatures that fail are pushed 10 ft away." }),

  // ---- 2nd level ----
  sp({ id: "hold-person", name: "Hold Person", level: 2, school: "enchantment", castingTime: "1 action", range: "60 ft", components: "V, S, M", duration: "1 minute", concentration: true, ritual: false, classes: [B, C, D, S, K, W], save: "wis", summary: "A humanoid is paralysed; it repeats the save at the end of each of its turns." }),
  sp({ id: "misty-step", name: "Misty Step", level: 2, school: "conjuration", castingTime: "1 bonus action", range: "Self", components: "V", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, K, W], summary: "Teleport up to 30 ft to an unoccupied space you can see." }),
  sp({ id: "moonbeam", name: "Moonbeam", level: 2, school: "evocation", castingTime: "1 action", range: "120 ft", components: "V, S, M", duration: "1 minute", concentration: true, ritual: false, classes: [D], save: "con", halfOnSave: true, damage: [{ dice: "2d10", type: "radiant" }], upcast: { dice: "1d10" }, area: { shape: "cylinder", sizeFt: 5 }, summary: "A silvery beam of pale light; move it 60 ft as an action." }),
  sp({ id: "scorching-ray", name: "Scorching Ray", level: 2, school: "evocation", castingTime: "1 action", range: "120 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], attack: "ranged", damage: [{ dice: "2d6", type: "fire" }], beams: { count: 3, perUpcastLevel: 1 }, summary: "Three rays of fire, each a separate ranged spell attack." }),
  sp({ id: "shatter", name: "Shatter", level: 2, school: "evocation", castingTime: "1 action", range: "60 ft", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [B, S, K, W], save: "con", halfOnSave: true, damage: [{ dice: "3d8", type: "thunder" }], upcast: { dice: "1d8" }, area: { shape: "sphere", sizeFt: 10 }, summary: "A painfully loud ringing noise; inorganic creatures have disadvantage." }),
  sp({ id: "spiritual-weapon", name: "Spiritual Weapon", level: 2, school: "evocation", castingTime: "1 bonus action", range: "60 ft", components: "V, S", duration: "1 minute", concentration: false, ritual: false, classes: [C], attack: "melee", damage: [{ dice: "1d8", type: "force" }], upcast: { dice: "1d8", perLevels: 2 }, summary: "A floating weapon attacks as a bonus action; damage adds your spellcasting modifier." }),
  sp({ id: "web", name: "Web", level: 2, school: "conjuration", castingTime: "1 action", range: "60 ft", components: "V, S, M", duration: "1 hour", concentration: true, ritual: false, classes: [S, W], save: "dex", area: { shape: "cube", sizeFt: 20 }, summary: "Sticky webs; creatures that fail are restrained." }),

  // ---- 3rd level ----
  sp({ id: "counterspell", name: "Counterspell", level: 3, school: "abjuration", castingTime: "1 reaction", range: "60 ft", components: "S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, K, W], summary: "Interrupt a spell of 3rd level or lower; higher needs an ability check (DC 10 + level)." }),
  sp({ id: "dispel-magic", name: "Dispel Magic", level: 3, school: "abjuration", castingTime: "1 action", range: "120 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [B, C, D, P, S, K, W], summary: "End spells of 3rd level or lower on a target; higher needs a check." }),
  sp({ id: "fireball", name: "Fireball", level: 3, school: "evocation", castingTime: "1 action", range: "150 ft", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], save: "dex", halfOnSave: true, damage: [{ dice: "8d6", type: "fire" }], upcast: { dice: "1d6" }, area: { shape: "sphere", sizeFt: 20 }, summary: "A bright streak blossoms into an explosion of flame." }),
  sp({ id: "lightning-bolt", name: "Lightning Bolt", level: 3, school: "evocation", castingTime: "1 action", range: "Self (100-ft line)", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], save: "dex", halfOnSave: true, damage: [{ dice: "8d6", type: "lightning" }], upcast: { dice: "1d6" }, area: { shape: "line", sizeFt: 100, widthFt: 5 }, summary: "A stroke of lightning 100 ft long and 5 ft wide." }),
  sp({ id: "mass-healing-word", name: "Mass Healing Word", level: 3, school: "evocation", castingTime: "1 bonus action", range: "60 ft", components: "V", duration: "Instantaneous", concentration: false, ritual: false, classes: [C], heal: { dice: "1d4", addModifier: true }, upcast: { dice: "1d4" }, summary: "Up to six creatures you can see regain hit points." }),
  sp({ id: "revivify", name: "Revivify", level: 3, school: "necromancy", castingTime: "1 action", range: "Touch", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [C, P], summary: "A creature that died within the last minute returns with 1 hit point." }),
  sp({ id: "spirit-guardians", name: "Spirit Guardians", level: 3, school: "conjuration", castingTime: "1 action", range: "Self (15-ft radius)", components: "V, S, M", duration: "10 minutes", concentration: true, ritual: false, classes: [C], save: "wis", halfOnSave: true, damage: [{ dice: "3d8", type: "radiant" }], upcast: { dice: "1d8" }, area: { shape: "sphere", sizeFt: 15 }, summary: "Spirits flit around you; enemies' speed is halved in the area." }),

  // ---- 4th–9th level ----
  sp({ id: "banishment", name: "Banishment", level: 4, school: "abjuration", castingTime: "1 action", range: "60 ft", components: "V, S, M", duration: "1 minute", concentration: true, ritual: false, classes: [C, P, S, K, W], save: "cha", summary: "Send a creature to a harmless demiplane (or home, if it's from another plane)." }),
  sp({ id: "ice-storm", name: "Ice Storm", level: 4, school: "evocation", castingTime: "1 action", range: "300 ft", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [D, S, W], save: "dex", halfOnSave: true, damage: [{ dice: "2d8", type: "bludgeoning" }, { dice: "4d6", type: "cold" }], upcast: { dice: "1d8" }, area: { shape: "cylinder", sizeFt: 20 }, summary: "Hail pounds the area, which becomes difficult terrain." }),
  sp({ id: "cone-of-cold", name: "Cone of Cold", level: 5, school: "evocation", castingTime: "1 action", range: "Self (60-ft cone)", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], save: "con", halfOnSave: true, damage: [{ dice: "8d8", type: "cold" }], upcast: { dice: "1d8" }, area: { shape: "cone", sizeFt: 60 }, summary: "A blast of cold air; creatures killed become frozen statues." }),
  sp({ id: "flame-strike", name: "Flame Strike", level: 5, school: "evocation", castingTime: "1 action", range: "60 ft", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [C], save: "dex", halfOnSave: true, damage: [{ dice: "4d6", type: "fire" }, { dice: "4d6", type: "radiant" }], upcast: { dice: "1d6" }, area: { shape: "cylinder", sizeFt: 10 }, summary: "A column of divine fire roars down from above." }),
  sp({ id: "mass-cure-wounds", name: "Mass Cure Wounds", level: 5, school: "evocation", castingTime: "1 action", range: "60 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [B, C, D], heal: { dice: "3d8", addModifier: true }, upcast: { dice: "1d8" }, area: { shape: "sphere", sizeFt: 30 }, summary: "Up to six creatures in a 30-ft sphere regain hit points." }),
  sp({ id: "chain-lightning", name: "Chain Lightning", level: 6, school: "evocation", castingTime: "1 action", range: "150 ft", components: "V, S, M", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], save: "dex", halfOnSave: true, damage: [{ dice: "10d8", type: "lightning" }], summary: "A bolt leaps to the target and up to three others within 30 ft (one more per slot level above 6th)." }),
  sp({ id: "heal", name: "Heal", level: 6, school: "evocation", castingTime: "1 action", range: "60 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [C, D], heal: { dice: "70", addModifier: false }, upcast: { dice: "10" }, summary: "A creature regains 70 hit points and is cured of blindness, deafness and disease." }),
  sp({ id: "finger-of-death", name: "Finger of Death", level: 7, school: "necromancy", castingTime: "1 action", range: "60 ft", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, K, W], save: "con", halfOnSave: true, damage: [{ dice: "7d8+30", type: "necrotic" }], summary: "Negative energy; a humanoid killed rises as a zombie under your command." }),
  sp({ id: "meteor-swarm", name: "Meteor Swarm", level: 9, school: "evocation", castingTime: "1 action", range: "1 mile", components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [S, W], save: "dex", halfOnSave: true, damage: [{ dice: "20d6", type: "fire" }, { dice: "20d6", type: "bludgeoning" }], area: { shape: "sphere", sizeFt: 40 }, summary: "Four blazing orbs crash down; each point is in four 40-ft spheres." }),
];

export const getSrdSpell = (id: string) => SRD_SPELLS.find((s) => s.id === id);

export function searchSpells(query: string, filter: { level?: number; className?: string } = {}): SrdSpell[] {
  const q = query.trim().toLowerCase();
  return SRD_SPELLS.filter(
    (s) =>
      (filter.level === undefined || s.level === filter.level) &&
      (!filter.className || s.classes.includes(filter.className.toLowerCase())) &&
      (!q || s.name.toLowerCase().includes(q) || s.school.includes(q)),
  ).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** Cantrip damage dice multiplier at a given character level (1 / 2 / 3 / 4). */
export function cantripTier(characterLevel: number): number {
  return characterLevel >= 17 ? 4 : characterLevel >= 11 ? 3 : characterLevel >= 5 ? 2 : 1;
}

/** "3d6" x n → "3nd6"; constant parts multiply as well ("1d4+1" x 2 → "2d4+2"). */
export function multiplyDice(dice: string, n: number): string {
  if (n === 1) return dice;
  return dice.replace(/(\d*)d(\d+)|(\d+)/g, (_m, count: string | undefined, faces: string | undefined, flat: string | undefined) =>
    faces !== undefined ? `${(Number(count || 1) * n)}d${faces}` : String(Number(flat) * n),
  );
}

export interface SpellCastPlan {
  slotLevel: number;
  /** Separate attacks/missiles; each rolls its own attack (if any) and damage. */
  beams: number;
  /** Damage formulas per beam, one entry per damage type. */
  damage: Array<{ formula: string; type: string }>;
  heal: string | null;
}

/**
 * Works out what a cast at `slotLevel` rolls. `modifier` is the spellcasting
 * ability modifier (added to healing that says so, and to Spiritual Weapon).
 */
export function planCast(spell: SrdSpell, slotLevel: number, characterLevel: number, modifier: number): SpellCastPlan {
  const level = spell.level === 0 ? 0 : Math.max(spell.level, Math.min(9, slotLevel));
  const above = spell.level === 0 ? 0 : level - spell.level;
  const tier = spell.cantripScaling || spell.beams?.cantripScaling ? cantripTier(characterLevel) : 1;
  const upSteps = spell.upcast ? Math.floor(above / (spell.upcast.perLevels ?? 1)) : 0;
  const beams = spell.beams
    ? spell.beams.cantripScaling
      ? spell.beams.count * tier
      : spell.beams.count + above * (spell.beams.perUpcastLevel ?? 0)
    : 1;
  const mod = modifier !== 0 ? `${modifier > 0 ? "+" : ""}${modifier}` : "";
  const damage = (spell.damage ?? []).map((part, i) => {
    let formula = spell.cantripScaling && !spell.beams ? multiplyDice(part.dice, tier) : part.dice;
    if (i === 0 && upSteps > 0 && spell.upcast && !spell.heal) formula += `+${multiplyDice(spell.upcast.dice, upSteps)}`;
    if (i === 0 && spell.id === "spiritual-weapon") formula += mod;
    return { formula, type: part.type };
  });
  let heal: string | null = null;
  if (spell.heal) {
    heal = spell.heal.dice;
    if (upSteps > 0 && spell.upcast) heal += `+${multiplyDice(spell.upcast.dice, upSteps)}`;
    if (spell.heal.addModifier) heal += mod;
  }
  return { slotLevel: level, beams, damage, heal };
}

/** A character-sheet spell entry created from the library (id is unique per sheet). */
export function spellSheetEntry(s: SrdSpell, id: string) {
  return {
    id,
    name: s.name,
    level: s.level,
    school: s.school,
    prepared: s.level === 0,
    concentration: s.concentration,
    ritual: s.ritual,
    notes: "",
    srdId: s.id,
  };
}
