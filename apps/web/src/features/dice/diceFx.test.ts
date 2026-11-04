import { describe, expect, it } from "vitest";
import { roll, seededRng } from "@vtt/rules";
import { MAX_SHOWN_DICE, diceToShow, dieShape, shouldAnimate } from "./diceFx";

describe("dice animation helpers", () => {
  it("lists every die with dropped and crit/fumble flags", () => {
    const r = roll("2d20kh1+1d6", { rng: seededRng(7) });
    const { dice, hidden } = diceToShow(r);
    expect(dice).toHaveLength(3);
    expect(hidden).toBe(0);
    expect(dice.filter((d) => d.dropped)).toHaveLength(1);
    for (const d of dice) if (d.sides === 6) expect(d.tone).toBe("normal");
  });

  it("caps how many dice are drawn", () => {
    const { dice, hidden } = diceToShow(roll("20d6", { rng: seededRng(1) }));
    expect(dice).toHaveLength(MAX_SHOWN_DICE);
    expect(hidden).toBe(20 - MAX_SHOWN_DICE);
    expect(diceToShow(undefined)).toEqual({ dice: [], hidden: 0 });
  });

  it("gives each die a polygon and respects settings", () => {
    expect(dieShape(6).split(" ")).toHaveLength(4);
    expect(dieShape(4).split(" ")).toHaveLength(3);
    expect(dieShape(20).split(" ")).toHaveLength(6);
    expect(shouldAnimate(undefined, false)).toBe(true);
    expect(shouldAnimate(false, false)).toBe(false);
    expect(shouldAnimate(true, true)).toBe(false);
  });
});
