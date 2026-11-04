import { describe, expect, it } from "vitest";
import { DND5E_2014, deriveCharacter, emptyExtractedSheet, extractedSheetSchema, sheetToCharacterData } from "../src/index.js";

describe("sheet import mapping", () => {
  it("maps a typical extracted sheet to valid character data", () => {
    const sheet = {
      ...emptyExtractedSheet("Thorin"),
      species: "Dwarf",
      classes: [{ name: "Fighter", subclass: "Champion", level: 5 }],
      abilities: { str: 17, dex: 12, con: 16, int: 8, wis: 13, cha: 10 },
      savingThrowProficiencies: ["str", "con", "str"] as const,
      skillProficiencies: [
        { skill: "Athletics", level: "proficient" as const },
        { skill: "animal handling", level: "expertise" as const },
        { skill: "Basket weaving", level: "proficient" as const },
      ],
      armorClass: 18,
      maxHp: 44,
      currentHp: 30,
      attacks: [
        { name: "Longsword", attackBonus: 6, damage: "1d8 + 3", damageType: "Slashing" },
        { name: "Shove", attackBonus: null, damage: "special", damageType: null },
      ],
      currency: { cp: 0, sp: 10, ep: null, gp: 25, pp: null },
    };
    const parsed = extractedSheetSchema.parse({ ...sheet, savingThrowProficiencies: [...sheet.savingThrowProficiencies] });
    const { data, name, notes } = sheetToCharacterData(parsed, DND5E_2014);
    expect(name).toBe("Thorin");
    expect(data.classes).toEqual([{ name: "Fighter", subclass: "Champion", level: 5, hitDie: 10 }]);
    expect(data.saveProficiencies).toEqual(["str", "con"]);
    expect(data.skills).toEqual({ athletics: "proficient", animal_handling: "expertise" });
    expect(data.hp).toEqual({ max: 44, current: 30, temp: 0 });
    expect(data.attacks[0]).toMatchObject({ name: "Longsword", attackBonusOverride: 6, damage: "1d8+3", damageType: "slashing", addAbilityToDamage: false });
    expect(data.attacks[1]!.damage).toBe("");
    expect(notes.join(" ")).toMatch(/Basket weaving/);
    expect(notes.join(" ")).toMatch(/special/);
    const d = deriveCharacter(data, DND5E_2014);
    expect(d.proficiencyBonus.value).toBe(3);
    expect(d.attacks[0]!.attackBonus!.value).toBe(6);
  });

  it("clamps impossible numbers and fills unread values", () => {
    const sheet = { ...emptyExtractedSheet(""), classes: [{ name: "Wizard", subclass: null, level: 99 }], abilities: { str: 50, dex: -3, con: null, int: 20, wis: 10, cha: 10 }, maxHp: 20, currentHp: 500, armorClass: 99 };
    const { data, name, notes } = sheetToCharacterData(sheet, DND5E_2014);
    expect(name).toBe("Imported character");
    expect(data.classes[0]).toMatchObject({ level: 20, hitDie: 6 });
    expect(data.abilities).toMatchObject({ str: 30, dex: 1, con: 10 });
    expect(notes).toContain("CON wasn't read; set to 10");
    expect(data.hp.current).toBe(20);
    expect(data.armorClass).toBe(50);
  });
});
