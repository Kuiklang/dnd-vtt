import { describe, expect, it } from "vitest";
import { DiceSyntaxError, formatAst, parseDice, roll, seededRng, sequenceRng, validateFormula } from "../src/index.js";

describe("parseDice", () => {
  it.each([
    ["1d20", "1d20"],
    ["d20", "1d20"],
    ["2d6", "2d6"],
    ["1d20+5", "1d20+5"],
    ["4d6dl1", "4d6dl1"],
    ["2d20kh1", "2d20kh1"],
    ["2d20k1", "2d20kh1"],
    ["2d20kl1", "2d20kl1"],
    ["3d8+2d6+4", "3d8+2d6+4"],
    ["(1d4+1)*2", "(1d4+1)*2"],
    ["1d%", "1d100"],
    ["1d6!", "1d6!6"],
    ["1d6!>5", "1d6!>5"],
    ["1d20r1", "1d20r1"],
    ["2d6ro<3", "2d6ro<3"],
    ["1d8[slashing] + 3", "1d8[slashing]+3"],
    ["  1D20 + 2 ", "1d20+2"],
    ["-1d4", "-1d4"],
    ["10 - 2 - 3", "10-2-3"],
  ])("parses %s", (input, expected) => {
    expect(formatAst(parseDice(input))).toBe(expected);
  });

  it.each([
    "",
    "1d",
    "d",
    "1d20+",
    "abc",
    "1d20; process.exit()",
    "constructor",
    "1d0",
    "0d6",
    "1001d6",
    "1d10001",
    "(1d20",
    "1d20)",
    "2d6kh3",
    "2d6dl2",
    "2d6kh1dl1",
    "1d6r<7",
    "1d1!",
    "1d6!>0",
    "1d8[<script>]",
    "x".repeat(201),
    "((((((((((((((((((((((1))))))))))))))))))))))",
  ])("rejects %j", (input) => {
    expect(() => parseDice(input)).toThrow(DiceSyntaxError);
    expect(validateFormula(input)).not.toBeNull();
  });
});

describe("roll", () => {
  it("adds modifiers", () => {
    const r = roll("1d20+5", { rng: sequenceRng([12]) });
    expect(r.total).toBe(17);
    expect(r.terms[0]!.dice).toEqual([{ value: 12 }]);
  });

  it("respects operator precedence and left-associativity", () => {
    expect(roll("2+3*4").total).toBe(14);
    expect(roll("10-2-3").total).toBe(5);
    expect(roll("7/2").total).toBe(3);
    expect(roll("-7/2").total).toBe(-4);
    expect(roll("(2+3)*4").total).toBe(20);
  });

  it("throws on division by zero", () => {
    expect(() => roll("1/0")).toThrow(RangeError);
  });

  it("drops lowest for 4d6dl1", () => {
    const r = roll("4d6dl1", { rng: sequenceRng([3, 1, 6, 4]) });
    expect(r.total).toBe(13);
    expect(r.terms[0]!.dice.filter((d) => d.dropped).map((d) => d.value)).toEqual([1]);
  });

  it("keeps highest / lowest", () => {
    expect(roll("2d20kh1", { rng: sequenceRng([5, 17]) }).total).toBe(17);
    expect(roll("2d20kl1", { rng: sequenceRng([5, 17]) }).total).toBe(5);
    expect(roll("3d6dh1", { rng: sequenceRng([6, 2, 3]) }).total).toBe(5);
  });

  it("drops only one die on ties", () => {
    const r = roll("2d20kh1", { rng: sequenceRng([9, 9]) });
    expect(r.total).toBe(9);
    expect(r.terms[0]!.dice.filter((d) => d.dropped)).toHaveLength(1);
  });

  it("sums multiple terms", () => {
    const r = roll("3d8+2d6+4", { rng: sequenceRng([1, 2, 3, 4, 5]) });
    expect(r.total).toBe(1 + 2 + 3 + 4 + 5 + 4);
    expect(r.terms).toHaveLength(2);
  });

  it("explodes on max and marks extra dice", () => {
    const r = roll("1d6!", { rng: sequenceRng([6, 6, 2]) });
    expect(r.total).toBe(14);
    expect(r.terms[0]!.dice.map((d) => !!d.exploded)).toEqual([false, true, true]);
  });

  it("caps explosions", () => {
    const r = roll("1d2!", { rng: { int: () => 2 } });
    expect(r.terms[0]!.dice.length).toBe(101);
  });

  it("rerolls repeatedly and once", () => {
    const r = roll("1d20r1", { rng: sequenceRng([1, 1, 15]) });
    expect(r.total).toBe(15);
    expect(r.terms[0]!.dice[0]!.rerolledFrom).toEqual([1, 1]);
    const once = roll("1d20ro1", { rng: sequenceRng([1, 1]) });
    expect(once.total).toBe(1);
  });

  it("applies advantage and disadvantage to the primary d20", () => {
    const adv = roll("1d20+3", { mode: "advantage", rng: sequenceRng([4, 18]) });
    expect(adv.total).toBe(21);
    expect(adv.normalized).toBe("2d20kh1+3");
    expect(adv.terms[0]!.dice).toHaveLength(2);
    const dis = roll("1d20+3", { mode: "disadvantage", rng: sequenceRng([4, 18]) });
    expect(dis.total).toBe(7);
  });

  it("ignores advantage when there is no plain d20", () => {
    const r = roll("2d6+1", { mode: "advantage", rng: sequenceRng([1, 1]) });
    expect(r.mode).toBe("normal");
    expect(r.total).toBe(3);
  });

  it("flags critical and fumble on the kept d20 only", () => {
    expect(roll("1d20+5", { rng: sequenceRng([20]) }).critical).toBe(true);
    expect(roll("1d20+5", { rng: sequenceRng([1]) }).fumble).toBe(true);
    expect(roll("1d20", { mode: "advantage", rng: sequenceRng([20, 3]) }).critical).toBe(true);
    expect(roll("1d20", { mode: "disadvantage", rng: sequenceRng([20, 3]) }).critical).toBe(false);
    expect(roll("2d6", { rng: sequenceRng([6, 6]) }).critical).toBe(false);
  });

  it("keeps labels", () => {
    const r = roll("1d8[fire]+2", { rng: sequenceRng([5]) });
    expect(r.terms[0]!.label).toBe("fire");
  });

  it("produces results within range with the crypto RNG", () => {
    for (let i = 0; i < 500; i++) {
      const t = roll("1d20").total;
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(20);
    }
  });

  it("is roughly uniform (seeded)", () => {
    const rng = seededRng(42);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[roll("1d6", { rng }).total - 1]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });
});
