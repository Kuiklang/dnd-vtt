import { describe, expect, it } from "vitest";
import {
  ABILITIES,
  DND5E_2014,
  SRD_MONSTERS,
  XP_BY_CR,
  abilityModifier,
  deriveCharacter,
  encounterXp,
  getSrdMonster,
  monsterProficiency,
  monsterToCharacterData,
  monsterTokenStats,
  searchMonsters,
  seededRng,
  validateFormula,
} from "../src/index.js";

/** Average of a hit-dice formula like "5d10+10" (rounded down, as the SRD prints it). */
const average = (f: string) => {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(f)!;
  return Math.floor((Number(m[1]) * (Number(m[2]) + 1)) / 2 + Number(m[3] ?? 0));
};
/** Values the SRD prints that don't follow the formula; kept as printed. */
const PRINTED_ODDITIES = new Set(["priest:religion"]);
const SKILL_ABILITY = Object.fromEntries(DND5E_2014.skills.map((s) => [s.id, s.ability]));

describe("SRD bestiary data", () => {
  it("is internally consistent (HP = hit-dice average, XP = CR, valid formulas, known ids)", () => {
    const ids = new Set<string>();
    for (const m of SRD_MONSTERS) {
      expect(ids.has(m.id), m.id).toBe(false);
      ids.add(m.id);
      expect(average(m.hitDice), `${m.id} hp`).toBe(m.hp);
      expect(XP_BY_CR[m.cr], `${m.id} xp`).toBe(m.xp);
      const pb = monsterProficiency(m.cr);
      for (const [ab, bonus] of Object.entries(m.saves ?? {})) {
        const mod = abilityModifier(m.abilities[ab as (typeof ABILITIES)[number]]);
        expect([mod, mod + pb], `${m.id} save ${ab}`).toContain(bonus);
      }
      for (const [skill, bonus] of Object.entries(m.skills ?? {})) {
        expect(SKILL_ABILITY[skill], `${m.id} skill ${skill}`).toBeDefined();
        const mod = abilityModifier(m.abilities[SKILL_ABILITY[skill]!]);
        if (PRINTED_ODDITIES.has(`${m.id}:${skill}`)) continue;
        expect([mod + pb, mod + 2 * pb], `${m.id} skill ${skill}`).toContain(bonus);
      }
      for (const x of m.actions) {
        if (x.damage) expect(validateFormula(x.damage), `${m.id} ${x.name}`).toBeNull();
        if (x.extraDamage) expect(validateFormula(x.extraDamage.formula)).toBeNull();
        for (const t of [x.damageType, x.extraDamage?.type].filter(Boolean)) expect(DND5E_2014.damageTypes).toContain(t);
      }
      for (const t of [...(m.resistances ?? []), ...(m.immunities ?? []), ...(m.vulnerabilities ?? [])]) expect(DND5E_2014.damageTypes).toContain(t);
      for (const c of m.conditionImmunities ?? []) expect(DND5E_2014.conditions.map((k) => k.id)).toContain(c);
    }
    expect(SRD_MONSTERS.length).toBeGreaterThanOrEqual(25);
  });

  it("builds token stats (average or rolled HP) and searches by name/type/CR", () => {
    const goblin = getSrdMonster("goblin")!;
    expect(monsterTokenStats(goblin)).toMatchObject({ hp: { current: 7, max: 7, temp: 0 }, ac: 15, initiativeBonus: 2, statBlock: { type: "srd", id: "goblin" } });
    const rolled = monsterTokenStats(goblin, "roll", seededRng(3)).hp.max;
    expect(rolled).toBeGreaterThanOrEqual(2);
    expect(rolled).toBeLessThanOrEqual(12);
    expect(monsterTokenStats(getSrdMonster("skeleton")!).defenses).toEqual({ resistances: [], vulnerabilities: ["bludgeoning"], immunities: ["poison"] });
    expect(searchMonsters("undead").map((m) => m.id)).toEqual(["skeleton", "zombie", "ghoul", "wight"]);
    expect(searchMonsters("1/4").every((m) => m.cr === "1/4")).toBe(true);
    expect(searchMonsters("").at(-1)!.id).toBe("young-red-dragon");
    expect(encounterXp([{ xp: 50, count: 4 }, { xp: 200, count: 1 }])).toBe(400);
  });

  it("converts a stat block to character data that derives the printed numbers", () => {
    const captain = getSrdMonster("bandit-captain")!;
    const data = monsterToCharacterData(captain);
    const d = deriveCharacter(data, DND5E_2014);
    expect(d.proficiencyBonus.value).toBe(2);
    expect(d.savingThrows.str.value).toBe(4);
    expect(d.savingThrows.dex.value).toBe(5);
    expect(d.savingThrows.wis.value).toBe(2);
    expect(d.savingThrows.con.value).toBe(2);
    expect(d.skills.find((s) => s.id === "athletics")!.value).toBe(4);
    expect(data.hp.max).toBe(65);
    expect(data.attacks.map((x) => [x.name, x.attackBonusOverride, x.damage])).toEqual([
      ["Scimitar", 5, "1d6+3"],
      ["Dagger", 5, "1d4+3"],
    ]);
    expect(data.features.some((f) => f.name === "Reaction: Parry")).toBe(true);
    expect(data.notes.description).toContain("Challenge 2 (450 XP)");
  });
});
