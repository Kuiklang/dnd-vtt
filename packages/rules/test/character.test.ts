import { describe, expect, it } from "vitest";
import {
  DND5E_2014,
  DND5E_2024,
  abilityModifier,
  applyHpChange,
  buildHomebrewRuleset,
  deriveCharacter,
  migrateCharacterData,
  proficiencyBonusForLevel,
} from "../src/index.js";

const wizard = () =>
  migrateCharacterData({
    classes: [{ name: "Wizard", level: 5, hitDie: 6 }],
    abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 13, cha: 10 },
    saveProficiencies: ["int", "wis"],
    skills: { arcana: "expertise", perception: "proficient", stealth: "half" },
    spellcasting: { ability: "int" },
    attacks: [
      { id: "a1", name: "Dagger", ability: "dex", damage: "1d4", damageType: "piercing" },
      { id: "a2", name: "Fire Bolt", ability: "spell", damage: "2d10", addAbilityToDamage: false },
    ],
  });

describe("ability modifiers and proficiency", () => {
  it.each([
    [1, -5], [3, -4], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [15, 2], [18, 4], [20, 5], [30, 10],
  ])("score %i -> %i", (s, m) => expect(abilityModifier(s)).toBe(m));

  it.each([[1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [13, 5], [17, 6], [20, 6], [25, 6]])(
    "level %i -> PB %i",
    (lvl, pb) => expect(proficiencyBonusForLevel(DND5E_2014, lvl)).toBe(pb),
  );
});

describe("deriveCharacter", () => {
  const d = deriveCharacter(wizard(), DND5E_2024);

  it("computes level, PB, saves", () => {
    expect(d.totalLevel).toBe(5);
    expect(d.proficiencyBonus).toEqual({ value: 3, source: "computed" });
    expect(d.savingThrows.int).toMatchObject({ value: 7, proficient: true });
    expect(d.savingThrows.str).toMatchObject({ value: -1, proficient: false });
  });

  it("computes skills incl. expertise and half proficiency", () => {
    const sk = Object.fromEntries(d.skills.map((s) => [s.id, s.value]));
    expect(sk.arcana).toBe(4 + 6);
    expect(sk.perception).toBe(1 + 3);
    expect(sk.stealth).toBe(2 + 1);
    expect(sk.athletics).toBe(-1);
  });

  it("computes passive perception, initiative, spell DC and attack", () => {
    expect(d.passivePerception.value).toBe(14);
    expect(d.initiative.value).toBe(2);
    expect(d.spellSaveDc?.value).toBe(15);
    expect(d.spellAttackBonus?.value).toBe(7);
  });

  it("computes weapon and spell attacks", () => {
    expect(d.attacks[0]).toMatchObject({ attackBonus: { value: 5 }, damageFormula: "1d4+2" });
    expect(d.attacks[1]).toMatchObject({ attackBonus: { value: 7 }, damageFormula: "2d10" });
  });

  it("honours overrides and reports their source", () => {
    const data = wizard();
    data.overrides.initiative = 9;
    expect(deriveCharacter(data, DND5E_2024).initiative).toEqual({ value: 9, source: "override" });
  });

  it("applies exhaustion per ruleset without mixing versions", () => {
    const data = wizard();
    data.conditions.push({ id: "exhaustion", level: 2, source: "", durationRounds: null });
    const d24 = deriveCharacter(data, DND5E_2024);
    expect(d24.d20Penalty).toBe(4);
    expect(d24.initiative.value).toBe(-2);
    expect(d24.speed).toBe(20);
    const d14 = deriveCharacter(data, DND5E_2014);
    expect(d14.d20Penalty).toBe(0);
    expect(d14.speed).toBe(15);
  });

  it("warns about out-of-range values", () => {
    const data = wizard();
    data.classes[0]!.level = 25;
    expect(deriveCharacter(data, DND5E_2014).warnings.join(" ")).toMatch(/exceeds/);
  });

  it("tracks hit dice", () => {
    const data = migrateCharacterData({
      classes: [{ name: "Fighter", level: 3, hitDie: 10 }, { name: "Wizard", level: 2, hitDie: 6 }],
      hitDiceUsed: 2,
    });
    expect(deriveCharacter(data, DND5E_2014).hitDice).toEqual({ total: 5, remaining: 3, byDie: { d10: 3, d6: 2 } });
  });
});

describe("character schema", () => {
  it("fills defaults", () => {
    const c = migrateCharacterData({});
    expect(c.abilities.str).toBe(10);
    expect(c.spellcasting.slots).toHaveLength(9);
  });
  it("rejects unknown keys, bad formulas, bad URLs and future versions", () => {
    expect(() => migrateCharacterData({ hacked: true })).toThrow();
    expect(() => migrateCharacterData({ attacks: [{ id: "x", name: "x", damage: "1d6;alert(1)" }] })).toThrow();
    expect(() => migrateCharacterData({ portraitUrl: "javascript:alert(1)" })).toThrow();
    expect(() => migrateCharacterData({ schemaVersion: 99 })).toThrow(/Unsupported/);
    expect(() => migrateCharacterData(null)).toThrow();
  });
});

describe("HP changes", () => {
  const hp = { max: 20, current: 15, temp: 5 };
  it("damage hits temp HP first and floors at 0", () => {
    expect(applyHpChange(hp, { kind: "damage", amount: 3 })).toEqual({ max: 20, current: 15, temp: 2 });
    expect(applyHpChange(hp, { kind: "damage", amount: 8 })).toEqual({ max: 20, current: 12, temp: 0 });
    expect(applyHpChange(hp, { kind: "damage", amount: 100 })).toEqual({ max: 20, current: 0, temp: 0 });
  });
  it("healing caps at max; temp HP takes the higher value", () => {
    expect(applyHpChange(hp, { kind: "heal", amount: 50 }).current).toBe(20);
    expect(applyHpChange(hp, { kind: "temp", amount: 3 }).temp).toBe(5);
    expect(applyHpChange(hp, { kind: "temp", amount: 8 }).temp).toBe(8);
  });
});

describe("homebrew rulesets", () => {
  it("overrides only allowed fields and keeps base values", () => {
    const hb = buildHomebrewRuleset(DND5E_2014, { id: "gritty", name: "Gritty" }, {
      criticalOn: 19,
      extraConditions: [{ id: "bleeding", name: "Bleeding", summary: "Loses HP each turn." }],
    });
    expect(hb.id).toBe("custom:gritty");
    expect(hb.combat.criticalOn).toBe(19);
    expect(hb.exhaustion.model).toBe("table-2014");
    expect(hb.conditions.some((c) => c.id === "bleeding")).toBe(true);
  });
  it("rejects unknown override keys and duplicate conditions", () => {
    expect(() => buildHomebrewRuleset(DND5E_2014, { id: "x", name: "x" }, { abilities: [] })).toThrow();
    expect(() =>
      buildHomebrewRuleset(DND5E_2014, { id: "x", name: "x" }, { extraConditions: [{ id: "prone", name: "P", summary: "" }] }),
    ).toThrow(/already exists/);
  });
});
