import { describe, expect, it } from "vitest";
import {
  DND5E_2014,
  SRD_CLASSES,
  SRD_RACES,
  CreatorError,
  buildSrdCharacter,
  defaultCreatorChoices,
  deriveCharacter,
  pointBuyCost,
  validateCreatorChoices,
  type CreatorChoices,
} from "../src/index.js";

const choices = (over: Partial<CreatorChoices>): CreatorChoices => ({ ...defaultCreatorChoices(), name: "Test", ...over });

describe("SRD 2014 character creator", () => {
  it("builds a hill dwarf cleric with correct HP, AC, skills and slots", () => {
    const c = choices({
      raceId: "dwarf",
      classId: "cleric",
      backgroundId: "acolyte",
      baseAbilities: { str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 },
      classSkills: ["medicine", "history"],
    });
    expect(validateCreatorChoices(c, DND5E_2014)).toEqual([]);
    const { name, data } = buildSrdCharacter(c, DND5E_2014);
    expect(name).toBe("Test");
    expect(data.abilities).toMatchObject({ con: 15, wis: 16 });
    // d8 + CON +2 + Dwarven Toughness 1
    expect(data.hp).toEqual({ max: 11, current: 11, temp: 0 });
    expect(data.armorClass).toBe(10);
    expect(data.speed).toBe(25);
    expect(data.species).toBe("Hill Dwarf");
    expect(data.classes[0]).toMatchObject({ name: "Cleric", subclass: "Life Domain", level: 1, hitDie: 8 });
    expect(data.saveProficiencies).toEqual(["wis", "cha"]);
    expect(Object.keys(data.skills).sort()).toEqual(["history", "insight", "medicine", "religion"]);
    expect(data.defenses.resistances).toEqual(["poison"]);
    expect(data.spellcasting.ability).toBe("wis");
    expect(data.spellcasting.slots[0]!.max).toBe(2);
    expect(data.features.find((f) => f.name === "Shelter of the Faithful")?.source).toBe("background");
    expect(data.features.find((f) => f.name === "Disciple of Life")?.source).toBe("subclass");

    const d = deriveCharacter(data, DND5E_2014);
    expect(d.proficiencyBonus.value).toBe(2);
  });

  it("applies unarmored defense, feature uses, and half-elf choices", () => {
    const barb = buildSrdCharacter(
      choices({ raceId: "half-orc", classId: "barbarian", baseAbilities: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, classSkills: ["athletics", "survival"] }),
      DND5E_2014,
    ).data;
    // DEX 14 (+2), CON 14 (+2)
    expect(barb.armorClass).toBe(14);
    expect(barb.hp.max).toBe(14);
    expect(barb.features.find((f) => f.name === "Rage")?.uses).toEqual({ max: 2, used: 0 });
    expect(barb.skills.intimidation).toBe("proficient");

    const bard = buildSrdCharacter(
      choices({
        raceId: "half-elf",
        classId: "bard",
        backgroundId: "custom",
        customBackgroundName: "Wandering minstrel",
        customBackgroundSkills: ["performance", "history"],
        method: "pointbuy",
        baseAbilities: { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 15 },
        freeBonusAbilities: ["dex", "con"],
        classSkills: ["persuasion", "deception", "insight"],
        raceSkills: ["stealth", "perception"],
      }),
      DND5E_2014,
    ).data;
    expect(bard.abilities).toMatchObject({ dex: 15, con: 15, cha: 17 });
    expect(bard.background).toBe("Wandering minstrel");
    expect(Object.keys(bard.skills)).toHaveLength(7);
    expect(bard.features.find((f) => f.name === "Bardic Inspiration")?.uses?.max).toBe(3);
  });

  it("rejects invalid choices with readable errors", () => {
    expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
    expect(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBeNull();
    const bad = choices({
      name: " ",
      classId: "cleric",
      method: "pointbuy",
      baseAbilities: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 },
      classSkills: ["insight", "history"],
    });
    const errors = validateCreatorChoices(bad, DND5E_2014);
    expect(errors).toContain("Enter a name.");
    expect(errors.some((e) => e.includes("over budget"))).toBe(true);
    expect(errors.some((e) => e.includes("repeats"))).toBe(true);
    expect(() => buildSrdCharacter(bad, DND5E_2014)).toThrow(CreatorError);

    const halfElf = choices({ raceId: "half-elf", freeBonusAbilities: ["cha", "str"], classSkills: ["athletics", "history"], raceSkills: ["athletics", "stealth"] });
    const he = validateCreatorChoices(halfElf, DND5E_2014);
    expect(he.some((e) => e.includes("+1 bonuses"))).toBe(true);
    expect(he.some((e) => e.includes("must differ"))).toBe(true);
  });

  it("every class's skill options exist in the ruleset", () => {
    const ids = new Set(DND5E_2014.skills.map((s) => s.id));
    for (const c of SRD_CLASSES) if (c.skillOptions !== "any") for (const s of c.skillOptions) expect(ids.has(s), `${c.id}:${s}`).toBe(true);
    for (const r of SRD_RACES) for (const s of r.skills ?? []) expect(ids.has(s)).toBe(true);
  });
});
