import { abilityModifier, monsterTokenStats, type SrdMonster } from "@vtt/rules";
import type { CharacterFull } from "../../lib/types";
import type { TokenInput } from "../table/useTable";

const SIZE_CELLS: Record<SrdMonster["size"], number> = { Tiny: 0.5, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };

export interface PlaceOptions {
  count: number;
  hp: "average" | "roll";
  hidden: boolean;
}

/** Monster tokens are hidden-HP NPC tokens with their own copy of HP, so each one can be hurt separately. */
export function srdPlacements(m: SrdMonster, o: PlaceOptions): TokenInput[] {
  return Array.from({ length: o.count }, (_, i) => ({
    name: o.count > 1 ? `${m.name} ${i + 1}` : m.name,
    size: SIZE_CELLS[m.size],
    color: "#7a2a20",
    hidden: o.hidden,
    hpVisibility: "gm",
    stats: monsterTokenStats(m, o.hp),
  }));
}

/** Tokens from a campaign monster/NPC sheet. HP is copied per token (not linked) for the same reason. */
export function characterPlacements(c: CharacterFull, o: Omit<PlaceOptions, "hp">): TokenInput[] {
  const d = c.data;
  return Array.from({ length: o.count }, (_, i) => ({
    name: o.count > 1 ? `${c.name} ${i + 1}` : c.name,
    size: 1,
    color: d.color,
    hidden: o.hidden,
    hpVisibility: "gm",
    stats: {
      hp: { current: d.hp.max, max: d.hp.max, temp: 0 },
      ac: d.armorClass,
      initiativeBonus: abilityModifier(d.abilities.dex),
      conditions: [],
      defenses: d.defenses,
      statBlock: { type: "character", id: c.id },
    },
  }));
}
