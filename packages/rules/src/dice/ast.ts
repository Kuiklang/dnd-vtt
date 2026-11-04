/**
 * Dice expression AST.
 *
 * Grammar (whitespace-insensitive, case-insensitive):
 *
 *   expr     := term (('+' | '-') term)*
 *   term     := unary (('*' | '/') unary)*
 *   unary    := '-' unary | primary
 *   primary  := NUMBER | dice | '(' expr ')'
 *   dice     := NUMBER? 'd' (NUMBER | '%') modifier* label?
 *   modifier := ('kh' | 'kl' | 'k') NUMBER?        keep highest / lowest (k == kh)
 *             | ('dh' | 'dl') NUMBER?              drop highest / lowest
 *             | 'r' compare? NUMBER                reroll (repeatedly) while matching
 *             | 'ro' compare? NUMBER               reroll once
 *             | '!' (compare? NUMBER)?             exploding dice (default: on max)
 *   compare  := '<' | '>' | '<=' | '>=' | '='
 *   label    := '[' text ']'                       e.g. 1d8[slashing]
 *
 * `/` is integer division rounding down, as most 5e rules round down.
 */

export type Comparator = "=" | "<" | ">" | "<=" | ">=";

export interface CompareSpec {
  op: Comparator;
  value: number;
}

export type DiceModifier =
  | { kind: "keep"; which: "highest" | "lowest"; count: number }
  | { kind: "drop"; which: "highest" | "lowest"; count: number }
  | { kind: "reroll"; once: boolean; when: CompareSpec }
  | { kind: "explode"; when: CompareSpec };

export interface NumberNode {
  type: "number";
  value: number;
}

export interface DiceNode {
  type: "dice";
  count: number;
  sides: number;
  modifiers: DiceModifier[];
  label?: string;
}

export interface BinaryNode {
  type: "binary";
  op: "+" | "-" | "*" | "/";
  left: DiceAst;
  right: DiceAst;
}

export interface NegateNode {
  type: "negate";
  operand: DiceAst;
}

export interface GroupNode {
  type: "group";
  inner: DiceAst;
}

export type DiceAst = NumberNode | DiceNode | BinaryNode | NegateNode | GroupNode;

export function compare(value: number, spec: CompareSpec): boolean {
  switch (spec.op) {
    case "=":
      return value === spec.value;
    case "<":
      return value < spec.value;
    case ">":
      return value > spec.value;
    case "<=":
      return value <= spec.value;
    case ">=":
      return value >= spec.value;
  }
}

/** Renders an AST back to canonical notation (used for display & storage). */
export function formatAst(node: DiceAst): string {
  switch (node.type) {
    case "number":
      return String(node.value);
    case "group":
      return `(${formatAst(node.inner)})`;
    case "negate":
      return `-${formatAst(node.operand)}`;
    case "binary":
      return `${formatAst(node.left)}${node.op}${formatAst(node.right)}`;
    case "dice": {
      let s = `${node.count}d${node.sides}`;
      for (const m of node.modifiers) {
        switch (m.kind) {
          case "keep":
            s += `k${m.which === "highest" ? "h" : "l"}${m.count}`;
            break;
          case "drop":
            s += `d${m.which === "highest" ? "h" : "l"}${m.count}`;
            break;
          case "reroll":
            s += `r${m.once ? "o" : ""}${m.when.op === "=" ? "" : m.when.op}${m.when.value}`;
            break;
          case "explode":
            s += `!${m.when.op === "=" ? "" : m.when.op}${m.when.value}`;
            break;
        }
      }
      if (node.label) s += `[${node.label}]`;
      return s;
    }
  }
}
