import { formatModifier } from "@vtt/rules";
import type { CharacterData, RollMode } from "@vtt/rules";

export const mod = formatModifier;

export function characterSummary(data: Pick<CharacterData, "classes" | "species">): string {
  const classes = data.classes.map((c) => `${c.name} ${c.level}`).join(" / ");
  return [data.species, classes].filter(Boolean).join(" · ");
}

export function newId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

/** 5e: advantage and disadvantage cancel out; otherwise either one applies. */
export function combineModes(a: RollMode, b: RollMode = "normal"): RollMode {
  if (a === "normal") return b;
  if (b === "normal" || a === b) return a;
  return "normal";
}

/** 5e critical hits roll the damage dice twice: double each NdX count, keep flat modifiers. */
export function critFormula(formula: string): string {
  return formula.replace(/(\d*)d(\d+|%)/gi, (_, n: string, s: string) => `${(Number(n) || 1) * 2}d${s}`);
}
