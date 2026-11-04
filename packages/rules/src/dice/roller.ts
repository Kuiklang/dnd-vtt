import { compare, formatAst, type DiceAst, type DiceNode } from "./ast.js";
import { parseDice } from "./parser.js";
import { cryptoRng, type Rng } from "../rng.js";

export const MAX_EXPLOSIONS_PER_DIE = 100;
export const MAX_REROLLS_PER_DIE = 100;

export interface DieResult {
  /** Final face value of this die. */
  value: number;
  /** Earlier values replaced by rerolls (in order). */
  rerolledFrom?: number[];
  /** True when this die was produced by an explosion. */
  exploded?: boolean;
  /** True when removed by a keep/drop modifier. */
  dropped?: boolean;
}

export interface DiceTermResult {
  notation: string;
  count: number;
  sides: number;
  label?: string;
  dice: DieResult[];
  subtotal: number;
}

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface RollResult {
  formula: string;
  /** Canonical formula actually rolled (after applying advantage etc). */
  normalized: string;
  mode: RollMode;
  total: number;
  terms: DiceTermResult[];
  /** Natural 20 on the primary d20 (only for single-d20 tests). */
  critical: boolean;
  /** Natural 1 on the primary d20 (only for single-d20 tests). */
  fumble: boolean;
}

function rollTerm(node: DiceNode, rng: Rng): DiceTermResult {
  const dice: DieResult[] = [];
  const reroll = node.modifiers.find((m) => m.kind === "reroll");
  const explode = node.modifiers.find((m) => m.kind === "explode");

  const rollOne = (exploded: boolean): DieResult => {
    let value = rng.int(node.sides);
    const die: DieResult = { value };
    if (exploded) die.exploded = true;
    if (reroll && reroll.kind === "reroll") {
      let n = 0;
      while (compare(value, reroll.when) && n < MAX_REROLLS_PER_DIE) {
        (die.rerolledFrom ??= []).push(value);
        value = rng.int(node.sides);
        n++;
        if (reroll.once) break;
      }
      die.value = value;
    }
    return die;
  };

  for (let i = 0; i < node.count; i++) {
    let die = rollOne(false);
    dice.push(die);
    if (explode && explode.kind === "explode") {
      let n = 0;
      while (compare(die.value, explode.when) && n < MAX_EXPLOSIONS_PER_DIE) {
        die = rollOne(true);
        dice.push(die);
        n++;
      }
    }
  }

  const selection = node.modifiers.find((m) => m.kind === "keep" || m.kind === "drop");
  if (selection && (selection.kind === "keep" || selection.kind === "drop")) {
    // Sort indices by value; stable so ties resolve to the earliest die.
    const order = dice.map((d, i) => i).sort((a, b) => dice[a]!.value - dice[b]!.value || a - b);
    let toDrop: number[];
    if (selection.kind === "keep") {
      const dropCount = dice.length - selection.count;
      toDrop = selection.which === "highest" ? order.slice(0, dropCount) : order.slice(order.length - dropCount);
    } else {
      toDrop =
        selection.which === "lowest"
          ? order.slice(0, selection.count)
          : order.slice(order.length - selection.count);
    }
    for (const i of toDrop) dice[i]!.dropped = true;
  }

  const subtotal = dice.reduce((s, d) => (d.dropped ? s : s + d.value), 0);
  return {
    notation: formatAst(node),
    count: node.count,
    sides: node.sides,
    ...(node.label ? { label: node.label } : {}),
    dice,
    subtotal,
  };
}

function evaluate(
  node: DiceAst,
  rng: Rng,
  terms: DiceTermResult[],
  byNode: Map<DiceNode, DiceTermResult>,
): number {
  switch (node.type) {
    case "number":
      return node.value;
    case "group":
      return evaluate(node.inner, rng, terms, byNode);
    case "negate":
      return -evaluate(node.operand, rng, terms, byNode);
    case "dice": {
      const t = rollTerm(node, rng);
      terms.push(t);
      byNode.set(node, t);
      return t.subtotal;
    }
    case "binary": {
      const l = evaluate(node.left, rng, terms, byNode);
      const r = evaluate(node.right, rng, terms, byNode);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) throw new RangeError("Division by zero");
          return Math.floor(l / r);
      }
    }
  }
}

/** Finds the first plain single d20 (the "test die") in evaluation order. */
function findPrimaryD20(node: DiceAst): DiceNode | null {
  switch (node.type) {
    case "dice":
      return node.sides === 20 && node.count === 1 && node.modifiers.length === 0 ? node : null;
    case "group":
      return findPrimaryD20(node.inner);
    case "negate":
      return null;
    case "binary":
      return findPrimaryD20(node.left) ?? (node.op === "+" ? findPrimaryD20(node.right) : null);
    case "number":
      return null;
  }
}

/**
 * Applies advantage/disadvantage by turning the primary 1d20 into 2d20kh1 / 2d20kl1.
 * If the formula has no plain 1d20, the mode is ignored (and reported as normal).
 */
export function applyRollMode(ast: DiceAst, mode: RollMode): { ast: DiceAst; mode: RollMode } {
  if (mode === "normal") return { ast, mode };
  const d20 = findPrimaryD20(ast);
  if (!d20) return { ast, mode: "normal" };
  d20.count = 2;
  d20.modifiers = [{ kind: "keep", which: mode === "advantage" ? "highest" : "lowest", count: 1 }];
  return { ast, mode };
}

export function roll(formula: string, options: { mode?: RollMode; rng?: Rng } = {}): RollResult {
  const rng = options.rng ?? cryptoRng;
  const parsed = parseDice(formula);
  const plainD20 = findPrimaryD20(parsed);
  const { ast, mode } = applyRollMode(parsed, options.mode ?? "normal");
  const terms: DiceTermResult[] = [];
  const byNode = new Map<DiceNode, DiceTermResult>();
  const total = evaluate(ast, rng, terms, byNode);

  // Critical / fumble only make sense when the roll is a d20 test.
  let critical = false;
  let fumble = false;
  if (plainD20) {
    const kept = byNode.get(plainD20)?.dice.find((d) => !d.dropped);
    if (kept) {
      critical = kept.value === 20;
      fumble = kept.value === 1;
    }
  }
  return { formula, normalized: formatAst(ast), mode, total, terms, critical, fumble };
}

/** Validates a formula without rolling; returns an error message or null. */
export function validateFormula(formula: string): string | null {
  try {
    parseDice(formula);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid formula";
  }
}
