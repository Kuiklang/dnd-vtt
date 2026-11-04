import { useState } from "react";
import { applyHpChange, deriveCharacter, type CharacterData, type RulesetDefinition } from "@vtt/rules";
import { Button, cx } from "../../components/ui";
import { critFormula, mod, newId } from "./format";
import { NumberField, RollButton, Section, SourceTag, TextField } from "./fields";
import type { SetData } from "./CharacterSheet";

type Derived = ReturnType<typeof deriveCharacter>;
type Roll = ((formula: string, label: string, rollType: string, d20?: boolean) => void) | undefined;

export function CombatSection({
  data,
  derived,
  ruleset,
  editable,
  setData,
  roll,
  d20,
}: {
  data: CharacterData;
  derived: Derived;
  ruleset: RulesetDefinition;
  editable: boolean;
  setData: SetData;
  roll: Roll;
  d20: (n: number) => string;
}) {
  const [amount, setAmount] = useState(0);
  const hp = data.hp;
  const pct = hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0;
  const ds = ruleset.combat.deathSaves;

  const change = (kind: "damage" | "heal" | "temp") => {
    if (amount <= 0) return;
    setData((x) => ({ ...x, hp: applyHpChange(x.hp, { kind, amount }) }));
    setAmount(0);
  };

  return (
    <Section title="Combat">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Armor Class">
          <NumberField label="Armor class" value={data.armorClass} min={0} max={50} disabled={!editable} onChange={(n) => setData((x) => ({ ...x, armorClass: n }))} className="text-xl" />
        </Stat>
        <Stat label="Initiative">
          <RollButton value={mod(derived.initiative.value)} title="Roll initiative" onRoll={roll && (() => roll(d20(derived.initiative.value), "Initiative", "initiative"))} className="text-xl" />
          <SourceTag source={derived.initiative.source} />
        </Stat>
        <Stat label="Speed (ft)">
          <NumberField label="Base speed" value={data.speed} min={0} max={1000} disabled={!editable} onChange={(n) => setData((x) => ({ ...x, speed: n }))} className="text-xl" />
          {derived.speed !== data.speed && <span className="text-[10px] text-blood-400">effective {derived.speed}</span>}
        </Stat>
      </div>

      <div className="mt-3 rounded-md border border-ink-700 bg-ink-850 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wider text-parchment-500">Hit points</span>
          <span className="font-display text-2xl text-parchment-50">
            {hp.current}
            <span className="text-base text-parchment-500"> / {hp.max}</span>
            {hp.temp > 0 && <span className="ml-2 text-base text-arcane-400">+{hp.temp} temp</span>}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={hp.current} aria-valuemax={hp.max}>
          <div className={cx("h-full transition-all", pct > 50 ? "bg-moss-400" : pct > 20 ? "bg-gold-400" : "bg-blood-500")} style={{ width: `${pct}%` }} />
        </div>
        {editable && (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <label>
                <span className="text-parchment-500">Current</span>
                <NumberField label="Current HP" value={hp.current} min={0} max={10000} onChange={(n) => setData((x) => ((x.hp.current = n), x))} />
              </label>
              <label>
                <span className="text-parchment-500">Max</span>
                <NumberField label="Max HP" value={hp.max} min={0} max={10000} onChange={(n) => setData((x) => ((x.hp.max = n), (x.hp.current = Math.min(x.hp.current, n)), x))} />
              </label>
              <label>
                <span className="text-parchment-500">Temp</span>
                <NumberField label="Temporary HP" value={hp.temp} min={0} max={10000} onChange={(n) => setData((x) => ((x.hp.temp = n), x))} />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-20">
                <NumberField label="Amount" value={amount} min={0} max={10000} onChange={setAmount} />
              </div>
              <Button size="sm" variant="danger" onClick={() => change("damage")} disabled={amount <= 0}>
                Damage
              </Button>
              <Button size="sm" onClick={() => change("heal")} disabled={amount <= 0}>
                Heal
              </Button>
              <Button size="sm" variant="ghost" onClick={() => change("temp")} disabled={amount <= 0}>
                Temp HP
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-parchment-500">Damage uses temp HP first; healing can't exceed max; temp HP doesn't stack.</p>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border border-ink-700 p-2">
          <p className="text-xs uppercase text-parchment-500">Hit dice</p>
          <p>
            {derived.hitDice.remaining} / {derived.hitDice.total} left{" "}
            <span className="text-xs text-parchment-500">({Object.entries(derived.hitDice.byDie).map(([d, n]) => `${n}${d}`).join(" + ") || "—"})</span>
          </p>
          {editable && (
            <div className="mt-1 flex gap-1">
              <Button size="sm" variant="ghost" disabled={derived.hitDice.remaining <= 0} onClick={() => setData((x) => ((x.hitDiceUsed += 1), x))}>
                Spend
              </Button>
              <Button size="sm" variant="ghost" disabled={data.hitDiceUsed <= 0} onClick={() => setData((x) => ((x.hitDiceUsed = 0), x))}>
                Restore all
              </Button>
            </div>
          )}
        </div>
        <div className="rounded-md border border-ink-700 p-2">
          <p className="text-xs uppercase text-parchment-500">Death saves</p>
          <DeathRow label="Successes" value={data.deathSaves.successes} max={ds.successesToStabilize} tone="green" editable={editable} onChange={(n) => setData((x) => ((x.deathSaves.successes = n), x))} />
          <DeathRow label="Failures" value={data.deathSaves.failures} max={ds.failuresToDie} tone="red" editable={editable} onChange={(n) => setData((x) => ((x.deathSaves.failures = n), x))} />
          {roll && (
            <button className="mt-1 text-xs text-gold-400 hover:underline" onClick={() => roll("1d20", `Death save (DC ${ds.dc})`, "save", false)}>
              Roll death save
            </button>
          )}
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-gold-500" disabled={!editable} checked={data.inspiration} onChange={(e) => setData((x) => ({ ...x, inspiration: e.target.checked }))} />
        Heroic inspiration
      </label>
    </Section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-850 p-2">
      <p className="text-[10px] uppercase tracking-wider text-parchment-500">{label}</p>
      {children}
    </div>
  );
}

function DeathRow({ label, value, max, tone, editable, onChange }: { label: string; value: number; max: number; tone: "green" | "red"; editable: boolean; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-parchment-400">{label}</span>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          disabled={!editable}
          aria-label={`${label} ${i + 1}`}
          onClick={() => onChange(value === i + 1 ? i : i + 1)}
          className={cx("h-3.5 w-3.5 rounded-full border", i < value ? (tone === "green" ? "border-moss-400 bg-moss-400" : "border-blood-500 bg-blood-500") : "border-ink-500")}
        />
      ))}
    </div>
  );
}

export function ConditionsSection({ data, ruleset, editable, setData }: { data: CharacterData; ruleset: RulesetDefinition; editable: boolean; setData: SetData }) {
  const [pick, setPick] = useState("");
  const available = ruleset.conditions.filter((c) => !data.conditions.some((x) => x.id === c.id));
  const def = (id: string) => ruleset.conditions.find((c) => c.id === id);
  return (
    <Section title="Conditions">
      {data.conditions.length === 0 && <p className="text-sm text-parchment-500">No conditions.</p>}
      <ul className="space-y-1">
        {data.conditions.map((c, i) => {
          const d = def(c.id);
          return (
            <li key={c.id} className="rounded border border-ink-700 bg-ink-850 px-2 py-1 text-sm" title={d?.summary}>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-parchment-50">{d?.name ?? c.id}</span>
                {d?.maxLevel && (
                  <label className="flex items-center gap-1 text-xs text-parchment-400">
                    Lvl
                    <div className="w-12">
                      <NumberField label={`${d.name} level`} value={c.level ?? 1} min={1} max={d.maxLevel} disabled={!editable} onChange={(n) => setData((x) => ((x.conditions[i]!.level = n), x))} />
                    </div>
                  </label>
                )}
                <label className="flex items-center gap-1 text-xs text-parchment-400" title="Rounds remaining (blank = indefinite)">
                  ⏳
                  <input
                    aria-label="Duration in rounds"
                    disabled={!editable}
                    type="number"
                    min={0}
                    value={c.durationRounds ?? ""}
                    onChange={(e) => setData((x) => ((x.conditions[i]!.durationRounds = e.target.value === "" ? null : Math.max(0, Math.min(100000, Number(e.target.value) | 0))), x))}
                    className="w-12 rounded border border-ink-600 bg-ink-900 px-1 text-center disabled:border-transparent disabled:bg-transparent"
                  />
                </label>
                {editable && (
                  <button aria-label={`Remove ${d?.name ?? c.id}`} className="text-blood-400" onClick={() => setData((x) => (x.conditions.splice(i, 1), x))}>
                    ✕
                  </button>
                )}
              </div>
              <TextField label="Condition source" value={c.source} disabled={!editable} maxLength={80} placeholder="Source (e.g. Ghoul claw)" onChange={(v) => setData((x) => ((x.conditions[i]!.source = v), x))} className="mt-1 text-xs" />
              {d && <p className="mt-1 text-[11px] text-parchment-500">{d.summary}</p>}
            </li>
          );
        })}
      </ul>
      {editable && available.length > 0 && (
        <div className="mt-2 flex gap-2">
          <select aria-label="Add condition" value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1 rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm">
            <option value="">Add condition…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!pick}
            onClick={() => {
              setData((x) => (x.conditions.push({ id: pick, source: "", durationRounds: null, ...(def(pick)?.maxLevel ? { level: 1 } : {}) }), x));
              setPick("");
            }}
          >
            Add
          </Button>
        </div>
      )}
    </Section>
  );
}

export function AttacksSection({ data, derived, editable, setData, roll, d20 }: { data: CharacterData; derived: Derived; editable: boolean; setData: SetData; roll: Roll; d20: (n: number) => string }) {
  return (
    <Section
      title="Attacks"
      actions={
        editable && (
          <button
            className="text-xs text-gold-400 hover:underline"
            onClick={() =>
              setData(
                (x) => (
                  x.attacks.push({
                    id: newId(),
                    name: "New attack",
                    ability: "str",
                    proficient: true,
                    magicBonus: 0,
                    attackBonusOverride: null,
                    damage: "1d6",
                    addAbilityToDamage: true,
                    damageType: "",
                    range: "",
                    properties: "",
                  }),
                  x
                ),
              )
            }
          >
            + Add attack
          </button>
        )
      }
    >
      {data.attacks.length === 0 && <p className="text-sm text-parchment-500">No attacks yet.</p>}
      <ul className="space-y-2">
        {data.attacks.map((a, i) => {
          const d = derived.attacks[i]!;
          return (
            <li key={a.id} className="rounded border border-ink-700 bg-ink-850 p-2 text-sm">
              <div className="flex items-center gap-2">
                <TextField label="Attack name" value={a.name} disabled={!editable} onChange={(v) => setData((x) => ((x.attacks[i]!.name = v), x))} className="flex-1 font-semibold" />
                {d.attackBonus && (
                  <Button size="sm" disabled={!roll} onClick={() => roll?.(d20(d.attackBonus!.value), `${a.name} attack`, "attack")} title="Roll to hit">
                    {mod(d.attackBonus.value)} to hit
                  </Button>
                )}
                {d.damageFormula && (
                  <Button size="sm" variant="ghost" disabled={!roll} onClick={() => roll?.(d.damageFormula, `${a.name} damage${a.damageType ? ` (${a.damageType})` : ""}`, "damage", false)} title="Roll damage">
                    {d.damageFormula} {a.damageType}
                  </Button>
                )}
                {d.damageFormula && roll && (
                  <Button size="sm" variant="ghost" onClick={() => roll(critFormula(d.damageFormula), `${a.name} critical damage`, "damage", false)} title="Critical hit: dice doubled">
                    Crit
                  </Button>
                )}
              </div>
              {editable && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <label>
                    <span className="text-parchment-500">Ability</span>
                    <select
                      value={a.ability}
                      onChange={(e) => setData((x) => ((x.attacks[i]!.ability = e.target.value as typeof a.ability), x))}
                      className="w-full rounded border border-ink-600 bg-ink-900 px-1 py-1"
                    >
                      {["str", "dex", "con", "int", "wis", "cha", "spell", "none"].map((v) => (
                        <option key={v} value={v}>
                          {v.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="text-parchment-500">Damage dice</span>
                    <TextField label="Damage formula" value={a.damage} maxLength={100} onChange={(v) => setData((x) => ((x.attacks[i]!.damage = v), x))} className="font-mono" />
                  </label>
                  <label>
                    <span className="text-parchment-500">Damage type</span>
                    <TextField label="Damage type" value={a.damageType} maxLength={30} onChange={(v) => setData((x) => ((x.attacks[i]!.damageType = v), x))} />
                  </label>
                  <label>
                    <span className="text-parchment-500">Magic bonus</span>
                    <NumberField label="Magic bonus" value={a.magicBonus} min={-20} max={20} onChange={(n) => setData((x) => ((x.attacks[i]!.magicBonus = n), x))} />
                  </label>
                  <label>
                    <span className="text-parchment-500">Range</span>
                    <TextField label="Range" value={a.range} maxLength={40} onChange={(v) => setData((x) => ((x.attacks[i]!.range = v), x))} />
                  </label>
                  <label className="col-span-2">
                    <span className="text-parchment-500">Properties</span>
                    <TextField label="Properties" value={a.properties} maxLength={200} onChange={(v) => setData((x) => ((x.attacks[i]!.properties = v), x))} />
                  </label>
                  <div className="flex flex-col justify-end gap-1">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" className="accent-gold-500" checked={a.proficient} onChange={(e) => setData((x) => ((x.attacks[i]!.proficient = e.target.checked), x))} /> Proficient
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" className="accent-gold-500" checked={a.addAbilityToDamage} onChange={(e) => setData((x) => ((x.attacks[i]!.addAbilityToDamage = e.target.checked), x))} /> Add mod to dmg
                    </label>
                  </div>
                  <button className="col-span-full text-left text-blood-400 hover:underline" onClick={() => setData((x) => (x.attacks.splice(i, 1), x))}>
                    Remove attack
                  </button>
                </div>
              )}
              {!editable && (a.range || a.properties) && <p className="mt-1 text-xs text-parchment-500">{[a.range, a.properties].filter(Boolean).join(" · ")}</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

