import { z } from "zod";
import { DND5E_2014, DND5E_2024 } from "./dnd5e.js";
import type { RulesetDefinition } from "./types.js";

export const BUILTIN_RULESETS: readonly RulesetDefinition[] = [DND5E_2014, DND5E_2024];
export const DEFAULT_RULESET_ID = DND5E_2024.id;

export function getBuiltinRuleset(id: string): RulesetDefinition | undefined {
  return BUILTIN_RULESETS.find((r) => r.id === id);
}

export function isBuiltinRulesetId(id: string): boolean {
  return BUILTIN_RULESETS.some((r) => r.id === id);
}

/**
 * Homebrew rulesets are expressed as a base ruleset plus a small, validated set of
 * overrides. Only fields listed here may be changed; anything else is inherited
 * from the chosen base — never from a different version.
 */
export const homebrewOverridesSchema = z
  .object({
    proficiencyByLevel: z.array(z.number().int().min(0).max(20)).min(1).max(40).optional(),
    maxLevel: z.number().int().min(1).max(40).optional(),
    movement: z
      .object({
        unitsPerSquare: z.number().positive().max(1000),
        unit: z.string().min(1).max(10),
        diagonal: z.enum(["uniform", "alternating", "euclidean"]),
      })
      .partial()
      .optional(),
    criticalOn: z.number().int().min(2).max(20).optional(),
    criticalDamage: z.enum(["double-dice", "max-plus-roll"]).optional(),
    extraConditions: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
          name: z.string().min(1).max(60),
          summary: z.string().max(500),
          maxLevel: z.number().int().min(1).max(20).optional(),
        }),
      )
      .max(50)
      .optional(),
  })
  .strict();

export type HomebrewOverrides = z.infer<typeof homebrewOverridesSchema>;

export function buildHomebrewRuleset(
  base: RulesetDefinition,
  meta: { id: string; name: string },
  rawOverrides: unknown,
): RulesetDefinition {
  const o = homebrewOverridesSchema.parse(rawOverrides);
  const maxLevel = o.maxLevel ?? base.maxLevel;
  const pb = o.proficiencyByLevel ?? base.proficiencyByLevel;
  if (pb.length < maxLevel) {
    throw new Error(`proficiencyByLevel must cover all ${maxLevel} levels`);
  }
  const conditionIds = new Set(base.conditions.map((c) => c.id));
  for (const c of o.extraConditions ?? []) {
    if (conditionIds.has(c.id)) throw new Error(`Condition '${c.id}' already exists in the base ruleset`);
  }
  return {
    ...base,
    id: meta.id.startsWith("custom:") ? meta.id : `custom:${meta.id}`,
    name: meta.name,
    baseRulesetId: base.id,
    version: `${base.version}+homebrew`,
    proficiencyByLevel: pb,
    maxLevel,
    movement: { ...base.movement, ...o.movement },
    combat: {
      ...base.combat,
      criticalOn: o.criticalOn ?? base.combat.criticalOn,
      criticalDamage: o.criticalDamage ?? base.combat.criticalDamage,
    },
    conditions: [...base.conditions, ...(o.extraConditions ?? [])],
  };
}
