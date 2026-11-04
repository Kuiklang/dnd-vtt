import { describe, expect, it } from "vitest";
import {
  DND5E_2014,
  DND5E_2024,
  applyHp,
  canSeeTokenVitals,
  emptyCharacterData,
  firstTurn,
  modifyDamage,
  nextTurn,
  orderCombatants,
  previousTurn,
  tickConditions,
  type CombatantOrderInfo,
} from "../src/index.js";

const def = { resistances: ["fire"], vulnerabilities: ["cold", "fire"], immunities: ["poison"] };

describe("damage", () => {
  it("applies immunity, resistance (round down) and vulnerability", () => {
    expect(modifyDamage(9, "poison", def)).toEqual({ amount: 0, notes: ["immune to poison"] });
    expect(modifyDamage(9, "cold", def).amount).toBe(18);
    // Resistance then vulnerability to the same type: floor(9/2)*2 = 8
    expect(modifyDamage(9, "fire", def).amount).toBe(8);
    expect(modifyDamage(9, "slashing", def).amount).toBe(9);
    expect(modifyDamage(9, null, def).amount).toBe(9);
    expect(modifyDamage(9, "FIRE", { resistances: ["fire"], vulnerabilities: [], immunities: [] }).amount).toBe(4);
  });

  it("temp HP absorbs damage first and HP floors at 0", () => {
    const r = applyHp({ current: 10, max: 20, temp: 5 }, { kind: "damage", amount: 8 });
    expect(r.hp).toEqual({ current: 7, max: 20, temp: 0 });
    expect(r.absorbedByTemp).toBe(5);
    const down = applyHp({ current: 3, max: 20, temp: 0 }, { kind: "damage", amount: 50 });
    expect(down.hp.current).toBe(0);
    expect(down.downed).toBe(true);
  });

  it("healing caps at max and starts from 0; temp HP doesn't stack", () => {
    expect(applyHp({ current: -5, max: 20, temp: 0 }, { kind: "heal", amount: 4 }).hp.current).toBe(4);
    expect(applyHp({ current: 18, max: 20, temp: 0 }, { kind: "heal", amount: 10 }).hp.current).toBe(20);
    const t = applyHp({ current: 5, max: 20, temp: 8 }, { kind: "temp", amount: 5 });
    expect(t.hp.temp).toBe(8);
    expect(t.notes[0]).toMatch(/don't stack/);
  });

  it("DM set overrides and clamps", () => {
    expect(applyHp({ current: 5, max: 20, temp: 0 }, { kind: "set", current: 50, max: 30 }).hp).toEqual({ current: 30, max: 30, temp: 0 });
  });

  it("both SRD rulesets list the 13 damage types; characters default to no defenses", () => {
    expect(DND5E_2014.damageTypes).toHaveLength(13);
    expect(DND5E_2024.damageTypes).toContain("force");
    expect(emptyCharacterData().defenses).toEqual({ resistances: [], vulnerabilities: [], immunities: [] });
  });
});

const c = (id: string, initiative: number | null, bonus = 0, extra: Partial<CombatantOrderInfo> = {}): CombatantOrderInfo => ({
  id, name: id, initiative, initiativeBonus: bonus, sortOrder: 0, defeated: false, ...extra,
});

describe("initiative and turns", () => {
  it("orders by initiative, then bonus, then DM order; unrolled last", () => {
    const order = orderCombatants([c("a", 12, 1), c("b", 18), c("c", 12, 3), c("d", null, 5), c("e", 12, 1, { sortOrder: -1 })]);
    expect(order.map((x) => x.id)).toEqual(["b", "c", "e", "a", "d"]);
  });

  it("advances, skips defeated, wraps rounds and can step back", () => {
    const list = [c("a", 20), c("b", 15, 0, { defeated: true }), c("c", 10)];
    let s = firstTurn(list);
    expect(s).toEqual({ round: 1, turnIndex: 0 });
    s = nextTurn(s, list);
    expect(s).toEqual({ round: 1, turnIndex: 2 });
    s = nextTurn(s, list);
    expect(s).toEqual({ round: 2, turnIndex: 0 });
    s = previousTurn(s, list);
    expect(s).toEqual({ round: 1, turnIndex: 2 });
    expect(previousTurn({ round: 1, turnIndex: 0 }, list)).toEqual({ round: 1, turnIndex: 0 });
  });

  it("does nothing when everyone is defeated or the list is empty", () => {
    expect(nextTurn({ round: 3, turnIndex: 0 }, [c("a", 1, 0, { defeated: true })])).toEqual({ round: 3, turnIndex: 0 });
    expect(nextTurn({ round: 1, turnIndex: 0 }, [])).toEqual({ round: 1, turnIndex: 0 });
  });

  it("ticks condition durations at end of turn", () => {
    const { kept, expired } = tickConditions([
      { id: "poisoned", durationRounds: 1 },
      { id: "prone", durationRounds: null },
      { id: "frightened", durationRounds: 3 },
    ]);
    expect(expired.map((x) => x.id)).toEqual(["poisoned"]);
    expect(kept).toEqual([{ id: "prone", durationRounds: null }, { id: "frightened", durationRounds: 2 }]);
  });
});

describe("vitals visibility", () => {
  const gm = { userId: "dm", isGameMaster: true };
  const p1 = { userId: "p1", isGameMaster: false };
  const p2 = { userId: "p2", isGameMaster: false };
  it("respects everyone / owners / gm", () => {
    expect(canSeeTokenVitals({ hpVisibility: "everyone", ownerIds: [] }, p2)).toBe(true);
    expect(canSeeTokenVitals({ hpVisibility: "owners", ownerIds: ["p1"] }, p1)).toBe(true);
    expect(canSeeTokenVitals({ hpVisibility: "owners", ownerIds: ["p1"] }, p2)).toBe(false);
    expect(canSeeTokenVitals({ hpVisibility: "gm", ownerIds: ["p1"] }, p1)).toBe(false);
    expect(canSeeTokenVitals({ hpVisibility: "gm", ownerIds: [] }, gm)).toBe(true);
  });
});
