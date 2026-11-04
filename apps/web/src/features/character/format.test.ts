import { describe, expect, it } from "vitest";
import { validateFormula } from "@vtt/rules";
import { characterSummary, combineModes, critFormula } from "./format";

describe("sheet helpers", () => {
  it("doubles damage dice on a critical hit and keeps modifiers", () => {
    expect(critFormula("1d8+3")).toBe("2d8+3");
    expect(critFormula("2d6+1d4[fire]-1")).toBe("4d6+2d4[fire]-1");
    expect(critFormula("d12")).toBe("2d12");
    expect(validateFormula(critFormula("1d8+3"))).toBeNull();
  });

  it("combines advantage and disadvantage per 5e", () => {
    expect(combineModes("normal", "advantage")).toBe("advantage");
    expect(combineModes("disadvantage")).toBe("disadvantage");
    expect(combineModes("advantage", "advantage")).toBe("advantage");
    expect(combineModes("advantage", "disadvantage")).toBe("normal");
  });

  it("summarises classes", () => {
    expect(characterSummary({ species: "Elf", classes: [{ name: "Rogue", level: 3, subclass: "", hitDie: 8 }, { name: "Wizard", level: 1, subclass: "", hitDie: 6 }] })).toBe("Elf · Rogue 3 / Wizard 1");
    expect(characterSummary({ species: "", classes: [] })).toBe("");
  });
});
