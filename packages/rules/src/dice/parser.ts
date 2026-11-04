import type { CompareSpec, Comparator, DiceAst, DiceModifier, DiceNode } from "./ast.js";

/**
 * Safe, hand-written recursive-descent parser for dice notation.
 * Never uses eval()/Function(); input is tokenised character by character and
 * anything not in the grammar is rejected with a positioned error.
 */

export const DICE_LIMITS = {
  maxFormulaLength: 200,
  maxDicePerTerm: 1000,
  maxTotalDice: 2000,
  maxSides: 10000,
  maxNumber: 1_000_000,
  maxDepth: 20,
  maxLabelLength: 32,
} as const;

export class DiceSyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(`${message} (at position ${position + 1})`);
    this.name = "DiceSyntaxError";
  }
}

class Parser {
  private pos = 0;
  private depth = 0;
  private totalDice = 0;

  constructor(private readonly src: string) {}

  parse(): DiceAst {
    this.skipWs();
    if (this.pos >= this.src.length) throw new DiceSyntaxError("Empty formula", 0);
    const ast = this.expr();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw new DiceSyntaxError(`Unexpected '${this.src[this.pos]}'`, this.pos);
    }
    return ast;
  }

  private skipWs() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private peek(): string | undefined {
    this.skipWs();
    return this.src[this.pos];
  }

  /** Peek without skipping whitespace — modifiers must be attached to the dice term. */
  private peekRaw(offset = 0): string | undefined {
    return this.src[this.pos + offset];
  }

  private expr(): DiceAst {
    let left = this.term();
    for (;;) {
      const c = this.peek();
      if (c === "+" || c === "-") {
        this.pos++;
        const right = this.term();
        left = { type: "binary", op: c, left, right };
      } else return left;
    }
  }

  private term(): DiceAst {
    let left = this.unary();
    for (;;) {
      const c = this.peek();
      if (c === "*" || c === "/") {
        this.pos++;
        const right = this.unary();
        left = { type: "binary", op: c, left, right };
      } else return left;
    }
  }

  private unary(): DiceAst {
    if (this.peek() === "-") {
      this.pos++;
      this.enter();
      const operand = this.unary();
      this.depth--;
      return { type: "negate", operand };
    }
    if (this.peek() === "+") {
      this.pos++;
      return this.unary();
    }
    return this.primary();
  }

  private enter() {
    if (++this.depth > DICE_LIMITS.maxDepth) {
      throw new DiceSyntaxError("Formula is nested too deeply", this.pos);
    }
  }

  private primary(): DiceAst {
    const c = this.peek();
    if (c === undefined) throw new DiceSyntaxError("Unexpected end of formula", this.pos);
    if (c === "(") {
      this.pos++;
      this.enter();
      const inner = this.expr();
      this.depth--;
      if (this.peek() !== ")") throw new DiceSyntaxError("Missing ')'", this.pos);
      this.pos++;
      return { type: "group", inner };
    }
    if (isDigit(c) || c === "d" || c === "D") {
      const start = this.pos;
      const n = isDigit(c) ? this.number() : undefined;
      const next = this.peekRaw();
      if (next === "d" || next === "D") {
        this.pos++;
        return this.dice(n ?? 1, start);
      }
      if (n === undefined) throw new DiceSyntaxError("Expected a number", start);
      return { type: "number", value: n };
    }
    throw new DiceSyntaxError(`Unexpected '${c}'`, this.pos);
  }

  private number(): number {
    const start = this.pos;
    while (this.pos < this.src.length && isDigit(this.src[this.pos]!)) this.pos++;
    if (start === this.pos) throw new DiceSyntaxError("Expected a number", start);
    const value = Number(this.src.slice(start, this.pos));
    if (!Number.isSafeInteger(value) || value > DICE_LIMITS.maxNumber) {
      throw new DiceSyntaxError(`Number too large (max ${DICE_LIMITS.maxNumber})`, start);
    }
    return value;
  }

  private dice(count: number, start: number): DiceNode {
    let sides: number;
    if (this.peekRaw() === "%") {
      this.pos++;
      sides = 100;
    } else if (this.peekRaw() !== undefined && isDigit(this.peekRaw()!)) {
      sides = this.number();
    } else {
      throw new DiceSyntaxError("Expected number of sides after 'd'", this.pos);
    }
    if (count < 1) throw new DiceSyntaxError("Must roll at least one die", start);
    if (count > DICE_LIMITS.maxDicePerTerm) {
      throw new DiceSyntaxError(`Too many dice (max ${DICE_LIMITS.maxDicePerTerm})`, start);
    }
    if (sides < 1) throw new DiceSyntaxError("Dice must have at least one side", start);
    if (sides > DICE_LIMITS.maxSides) {
      throw new DiceSyntaxError(`Too many sides (max ${DICE_LIMITS.maxSides})`, start);
    }
    this.totalDice += count;
    if (this.totalDice > DICE_LIMITS.maxTotalDice) {
      throw new DiceSyntaxError(`Too many dice in formula (max ${DICE_LIMITS.maxTotalDice})`, start);
    }

    const modifiers: DiceModifier[] = [];
    let hasSelection = false;
    for (;;) {
      const mod = this.modifier(count, sides);
      if (!mod) break;
      if (mod.kind === "keep" || mod.kind === "drop") {
        if (hasSelection) {
          throw new DiceSyntaxError("Only one keep/drop modifier per dice term", this.pos);
        }
        hasSelection = true;
      }
      modifiers.push(mod);
    }

    let label: string | undefined;
    if (this.peekRaw() === "[") {
      const close = this.src.indexOf("]", this.pos);
      if (close === -1) throw new DiceSyntaxError("Missing ']'", this.pos);
      label = this.src.slice(this.pos + 1, close).trim();
      if (label.length > DICE_LIMITS.maxLabelLength || !/^[\p{L}\p{N} _-]*$/u.test(label)) {
        throw new DiceSyntaxError("Invalid label", this.pos);
      }
      this.pos = close + 1;
    }
    return { type: "dice", count, sides, modifiers, ...(label ? { label } : {}) };
  }

  private modifier(count: number, sides: number): DiceModifier | null {
    const a = this.peekRaw()?.toLowerCase();
    const b = this.peekRaw(1)?.toLowerCase();
    if (a === "k") {
      const which = b === "l" ? "lowest" : "highest";
      this.pos += b === "l" || b === "h" ? 2 : 1;
      const n = this.optionalNumber() ?? 1;
      if (n < 0 || n > count) throw new DiceSyntaxError(`Cannot keep ${n} of ${count} dice`, this.pos);
      return { kind: "keep", which, count: n };
    }
    if (a === "d" && (b === "l" || b === "h")) {
      this.pos += 2;
      const n = this.optionalNumber() ?? 1;
      if (n < 0 || n >= count) throw new DiceSyntaxError(`Cannot drop ${n} of ${count} dice`, this.pos);
      return { kind: "drop", which: b === "l" ? "lowest" : "highest", count: n };
    }
    if (a === "r") {
      const once = b === "o";
      this.pos += once ? 2 : 1;
      const when = this.compareSpec("=");
      if (!when) throw new DiceSyntaxError("Reroll needs a value, e.g. r1 or r<3", this.pos);
      assertNotAlways(when, sides, this.pos, "reroll");
      return { kind: "reroll", once, when };
    }
    if (a === "!") {
      this.pos++;
      const when = this.compareSpec("=") ?? { op: "=", value: sides };
      if (sides === 1) throw new DiceSyntaxError("A one-sided die cannot explode", this.pos);
      assertNotAlways(when, sides, this.pos, "explode");
      return { kind: "explode", when };
    }
    return null;
  }

  private optionalNumber(): number | undefined {
    const c = this.peekRaw();
    return c !== undefined && isDigit(c) ? this.number() : undefined;
  }

  private compareSpec(defaultOp: Comparator): CompareSpec | null {
    let op: Comparator = defaultOp;
    const a = this.peekRaw();
    const b = this.peekRaw(1);
    if ((a === "<" || a === ">") && b === "=") {
      op = (a + b) as Comparator;
      this.pos += 2;
    } else if (a === "<" || a === ">" || a === "=") {
      op = a;
      this.pos++;
    }
    const n = this.optionalNumber();
    if (n === undefined) {
      if (op !== defaultOp || a === "=") throw new DiceSyntaxError("Expected a number", this.pos);
      return null;
    }
    return { op, value: n };
  }
}

/** Rejects reroll/explode conditions that every face would match (infinite loop). */
function assertNotAlways(spec: CompareSpec, sides: number, pos: number, what: string) {
  let matches = 0;
  for (let f = 1; f <= sides; f++) {
    if (
      (spec.op === "=" && f === spec.value) ||
      (spec.op === "<" && f < spec.value) ||
      (spec.op === ">" && f > spec.value) ||
      (spec.op === "<=" && f <= spec.value) ||
      (spec.op === ">=" && f >= spec.value)
    )
      matches++;
  }
  if (matches === sides) throw new DiceSyntaxError(`Cannot ${what} on every face`, pos);
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

export function parseDice(formula: string): DiceAst {
  if (typeof formula !== "string") throw new DiceSyntaxError("Formula must be text", 0);
  if (formula.length > DICE_LIMITS.maxFormulaLength) {
    throw new DiceSyntaxError(`Formula too long (max ${DICE_LIMITS.maxFormulaLength} characters)`, 0);
  }
  return new Parser(formula).parse();
}
