import { describe, expect, it } from "vitest";
import {
  SRD_SPELLS,
  cantripTier,
  getSrdSpell,
  multiplyDice,
  planCast,
  searchSpells,
  spellSheetEntry,
  validateFormula,
  characterDataSchema,
  pointInTemplate,
  templateOutline,
  templateShapeForArea,
  tokensInTemplate,
  type MapTemplate,
} from "../src/index.js";

const spell = (id: string) => getSrdSpell(id)!;

describe("SRD spell library", () => {
  it("has unique ids, valid levels and valid dice everywhere", () => {
    const ids = new Set(SRD_SPELLS.map((s) => s.id));
    expect(ids.size).toBe(SRD_SPELLS.length);
    expect(SRD_SPELLS.length).toBeGreaterThanOrEqual(45);
    for (const s of SRD_SPELLS) {
      expect(s.level).toBeGreaterThanOrEqual(0);
      expect(s.level).toBeLessThanOrEqual(9);
      expect(s.classes.length, s.id).toBeGreaterThan(0);
      for (const lvl of [s.level, 9]) for (const charLvl of [1, 20]) {
        const plan = planCast(s, lvl, charLvl, 3);
        for (const d of plan.damage) expect(validateFormula(d.formula), `${s.id} ${d.formula}`).toBeNull();
        if (plan.heal) expect(validateFormula(plan.heal), `${s.id} ${plan.heal}`).toBeNull();
      }
      if (s.cantripScaling || s.beams?.cantripScaling) expect(s.level).toBe(0);
    }
  });

  it("upcasts and scales cantrips like the SRD", () => {
    expect(planCast(spell("fireball"), 3, 5, 3).damage).toEqual([{ formula: "8d6", type: "fire" }]);
    expect(planCast(spell("fireball"), 5, 9, 3).damage[0]!.formula).toBe("8d6+2d6");
    expect(planCast(spell("fireball"), 1, 9, 3).slotLevel).toBe(3);
    expect(planCast(spell("fire-bolt"), 0, 4, 3).damage[0]!.formula).toBe("1d10");
    expect(planCast(spell("fire-bolt"), 0, 11, 3).damage[0]!.formula).toBe("3d10");
    expect(planCast(spell("eldritch-blast"), 0, 17, 3).beams).toBe(4);
    expect(planCast(spell("magic-missile"), 3, 5, 3)).toMatchObject({ beams: 5, damage: [{ formula: "1d4+1" }] });
    expect(planCast(spell("scorching-ray"), 2, 3, 3).beams).toBe(3);
    expect(planCast(spell("cure-wounds"), 2, 3, 3).heal).toBe("1d8+1d8+3");
    expect(planCast(spell("healing-word"), 1, 3, -1).heal).toBe("1d4-1");
    expect(planCast(spell("heal"), 7, 13, 4).heal).toBe("70+10");
    expect(planCast(spell("spiritual-weapon"), 4, 7, 3).damage[0]!.formula).toBe("1d8+1d8+3");
    expect(planCast(spell("spiritual-weapon"), 3, 7, 3).damage[0]!.formula).toBe("1d8+3");
    expect(planCast(spell("ice-storm"), 5, 9, 3).damage).toEqual([
      { formula: "2d8+1d8", type: "bludgeoning" },
      { formula: "4d6", type: "cold" },
    ]);
  });

  it("multiplies dice and constants", () => {
    expect(multiplyDice("1d4+1", 3)).toBe("3d4+3");
    expect(multiplyDice("d8", 2)).toBe("2d8");
    expect(cantripTier(4)).toBe(1);
    expect(cantripTier(5)).toBe(2);
    expect(cantripTier(20)).toBe(4);
  });

  it("searches and builds valid sheet entries", () => {
    expect(searchSpells("fire").map((s) => s.id)).toEqual(["fire-bolt", "faerie-fire", "fireball"]);
    expect(searchSpells("", { level: 0, className: "cleric" }).map((s) => s.id)).toContain("sacred-flame");
    const entry = spellSheetEntry(spell("fireball"), "sp1");
    const parsed = characterDataSchema.parse({ spellcasting: { ability: "int", spells: [entry] } });
    expect(parsed.spellcasting.spells[0]).toMatchObject({ srdId: "fireball", level: 3, prepared: false });
    // Old sheets without srdId still parse.
    expect(characterDataSchema.parse({ spellcasting: { ability: "int", spells: [{ id: "x", name: "Old", level: 1 }] } }).spellcasting.spells[0]!.srdId).toBe("");
  });
});

describe("AoE templates", () => {
  const g = { size: 70, unitsPerCell: 5 }; // 14 px per ft
  const at = (x: number, y: number) => ({ x, y });
  const base: MapTemplate = { shape: "circle", x: 0, y: 0, size: 20, width: 5, angle: 0 };

  it("circle and square", () => {
    expect(pointInTemplate(base, at(280, 0), g)).toBe(true);
    expect(pointInTemplate(base, at(281, 1), g)).toBe(false);
    const sq = { ...base, shape: "square" as const, size: 10 };
    expect(pointInTemplate(sq, at(70, 70), g)).toBe(true);
    expect(pointInTemplate(sq, at(71, 0), g)).toBe(false);
  });

  it("cone width equals its length and respects direction", () => {
    const cone = { ...base, shape: "cone" as const, size: 15, angle: 0 };
    expect(pointInTemplate(cone, at(210, 0), g)).toBe(true);
    expect(pointInTemplate(cone, at(210, 104), g)).toBe(true);
    expect(pointInTemplate(cone, at(210, 110), g)).toBe(false);
    expect(pointInTemplate(cone, at(-20, 0), g)).toBe(false);
    const down = { ...cone, angle: 90 };
    expect(pointInTemplate(down, at(0, 200), g)).toBe(true);
    expect(pointInTemplate(down, at(200, 0), g)).toBe(false);
  });

  it("line has a length and a width", () => {
    const line = { ...base, shape: "line" as const, size: 100, width: 5, angle: 45 };
    const d = 600 / Math.SQRT2;
    expect(pointInTemplate(line, at(d, d), g)).toBe(true);
    expect(pointInTemplate(line, at(d + 40, d - 40), g)).toBe(false);
    expect(pointInTemplate(line, at(1400, 1400), g)).toBe(false);
  });

  it("finds tokens inside and draws outlines", () => {
    const tokens = [
      { id: "a", ...at(100, 0) },
      { id: "b", ...at(500, 0) },
    ];
    expect(tokensInTemplate(base, tokens, g)).toEqual(["a"]);
    expect(templateOutline({ ...base, shape: "cone", size: 10 }, g)).toHaveLength(3);
    expect(templateOutline({ ...base, shape: "square", size: 10 }, g)[2]).toEqual({ x: 70, y: 70 });
    expect(templateShapeForArea("sphere")).toBe("circle");
    expect(templateShapeForArea("cube")).toBe("square");
  });
});
