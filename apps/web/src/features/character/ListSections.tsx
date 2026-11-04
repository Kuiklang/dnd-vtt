import { useState } from "react";
import { deriveCharacter, type CharacterData } from "@vtt/rules";
import { Button, Textarea, cx } from "../../components/ui";
import { mod, newId } from "./format";
import { NumberField, RollButton, Section, SourceTag, TextField } from "./fields";
import type { SetData } from "./CharacterSheet";
import { CastButton, GiveButton, LastCast, SrdSpellPicker, srdArea, type SheetActions } from "./SpellActions";

type Derived = ReturnType<typeof deriveCharacter>;
type Roll = ((formula: string, label: string, rollType: string, d20?: boolean) => void) | undefined;

export function SpellsSection({ data, derived, editable, setData, roll, d20, actions }: { data: CharacterData; derived: Derived; editable: boolean; setData: SetData; roll: Roll; d20: (n: number) => string; actions?: SheetActions }) {
  const sc = data.spellcasting;
  const [newSpell, setNewSpell] = useState({ name: "", level: 0 });
  const byLevel = Array.from({ length: 10 }, (_, lvl) => sc.spells.map((s, i) => ({ s, i })).filter(({ s }) => s.level === lvl));

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <Section title="Spellcasting">
        <label className="block text-sm">
          <span className="text-xs text-parchment-500">Casting ability</span>
          <select
            disabled={!editable}
            value={sc.ability}
            onChange={(e) => setData((x) => ((x.spellcasting.ability = e.target.value as typeof sc.ability), x))}
            className="mt-1 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1"
          >
            <option value="none">None</option>
            {["int", "wis", "cha"].map((a) => (
              <option key={a} value={a}>
                {a.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded border border-ink-700 p-2">
            <p className="text-[10px] uppercase text-parchment-500">Spell save DC</p>
            <p className="font-display text-xl">{derived.spellSaveDc?.value ?? "—"}</p>
            {derived.spellSaveDc && <SourceTag source={derived.spellSaveDc.source} />}
          </div>
          <div className="rounded border border-ink-700 p-2">
            <p className="text-[10px] uppercase text-parchment-500">Spell attack</p>
            {derived.spellAttackBonus ? (
              <RollButton value={mod(derived.spellAttackBonus.value)} title="Spell attack" onRoll={roll && (() => roll(d20(derived.spellAttackBonus!.value), "Spell attack", "attack"))} className="text-xl" />
            ) : (
              <p className="font-display text-xl">—</p>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs uppercase text-parchment-500">Spell slots (used / max)</p>
        <ul className="mt-1 space-y-1">
          {sc.slots.map((slot, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="w-10 text-parchment-400">Lvl {i + 1}</span>
              <div className="flex flex-1 flex-wrap gap-1">
                {Array.from({ length: slot.max }, (_, k) => (
                  <button
                    key={k}
                    disabled={!editable}
                    aria-label={`Level ${i + 1} slot ${k + 1}`}
                    onClick={() => setData((x) => ((x.spellcasting.slots[i]!.used = slot.used === k + 1 ? k : k + 1), x))}
                    className={cx("h-3.5 w-3.5 rounded-sm border", k < slot.used ? "border-ink-500 bg-ink-600" : "border-arcane-400 bg-arcane-500/40")}
                  />
                ))}
                {slot.max === 0 && <span className="text-xs text-parchment-500">—</span>}
              </div>
              {editable && (
                <div className="w-12">
                  <NumberField label={`Level ${i + 1} max slots`} value={slot.max} min={0} max={20} onChange={(n) => setData((x) => ((x.spellcasting.slots[i] = { max: n, used: Math.min(x.spellcasting.slots[i]!.used, n) }), x))} className="text-xs" />
                </div>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setData((x) => (x.spellcasting.slots.forEach((s) => (s.used = 0)), x))}>
            Long rest: restore slots
          </Button>
        )}
      </Section>
      <Section title="Spells" actions={editable && <SrdSpellPicker data={data} onAdd={(entry) => setData((x) => (x.spellcasting.spells.push(entry), x))} />}>
        {actions && <LastCast characterId={actions.characterId} onMap={actions.table.onMap} />}
        {sc.spells.length === 0 && <p className="text-sm text-parchment-500">No spells yet.</p>}
        {byLevel.map((list, lvl) =>
          list.length === 0 ? null : (
            <div key={lvl} className="mb-3">
              <p className="mb-1 text-xs uppercase tracking-wider text-parchment-500">{lvl === 0 ? "Cantrips" : `Level ${lvl}`}</p>
              <ul className="space-y-1">
                {list.map(({ s, i }) => (
                  <li key={s.id} className="flex items-center gap-2 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-sm">
                    {lvl > 0 && (
                      <input
                        type="checkbox"
                        title="Prepared"
                        aria-label={`${s.name} prepared`}
                        className="accent-gold-500"
                        disabled={!editable}
                        checked={s.prepared}
                        onChange={(e) => setData((x) => ((x.spellcasting.spells[i]!.prepared = e.target.checked), x))}
                      />
                    )}
                    <span className="flex-1">
                      {s.name}
                      {s.srdId && <span className="ml-1 text-[10px] text-parchment-500" title="Linked to the SRD spell library">SRD{srdArea(s.srdId) ? " · area" : ""}</span>}
                    </span>
                    {actions && <CastButton spell={s} data={data} actions={actions} />}
                    {editable ? (
                      <>
                        <label className="flex items-center gap-1 text-[10px] text-parchment-500" title="Concentration">
                          <input type="checkbox" className="accent-gold-500" checked={s.concentration} onChange={(e) => setData((x) => ((x.spellcasting.spells[i]!.concentration = e.target.checked), x))} />C
                        </label>
                        <label className="flex items-center gap-1 text-[10px] text-parchment-500" title="Ritual">
                          <input type="checkbox" className="accent-gold-500" checked={s.ritual} onChange={(e) => setData((x) => ((x.spellcasting.spells[i]!.ritual = e.target.checked), x))} />R
                        </label>
                        <button aria-label={`Remove ${s.name}`} className="text-blood-400" onClick={() => setData((x) => (x.spellcasting.spells.splice(i, 1), x))}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-parchment-500">
                        {s.concentration && "C "}
                        {s.ritual && "R"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
        {editable && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newSpell.name.trim()) return;
              setData((x) => (x.spellcasting.spells.push({ id: newId(), name: newSpell.name.trim(), level: newSpell.level, school: "", prepared: false, concentration: false, ritual: false, notes: "", srdId: "" }), x));
              setNewSpell({ name: "", level: newSpell.level });
            }}
          >
            <TextField label="New spell name" value={newSpell.name} placeholder="Spell name" onChange={(v) => setNewSpell({ ...newSpell, name: v })} />
            <select aria-label="New spell level" value={newSpell.level} onChange={(e) => setNewSpell({ ...newSpell, level: Number(e.target.value) })} className="rounded border border-ink-600 bg-ink-900 px-1 text-sm">
              {Array.from({ length: 10 }, (_, l) => (
                <option key={l} value={l}>
                  {l === 0 ? "Cantrip" : `Lvl ${l}`}
                </option>
              ))}
            </select>
            <Button size="sm" type="submit">
              Add
            </Button>
          </form>
        )}
        <p className="mt-3 text-[11px] text-parchment-500">
          {actions
            ? "Cast spends the slot and rolls on the server; spells with an area can be placed on the map as a template."
            : "Open this sheet from a campaign table to cast spells (spend slots and roll automatically)."}
        </p>
      </Section>
    </div>
  );
}

const ITEM_CATEGORIES = ["weapon", "armor", "shield", "potion", "consumable", "magic", "quest", "gear", "other"] as const;

export function InventorySection({ data, editable, setData, actions }: { data: CharacterData; editable: boolean; setData: SetData; actions?: SheetActions }) {
  const totalWeight = data.inventory.reduce((s, i) => s + i.weight * i.quantity, 0);
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <Section
        title="Inventory"
        actions={
          editable && (
            <button className="text-xs text-gold-400 hover:underline" onClick={() => setData((x) => (x.inventory.push({ id: newId(), name: "New item", category: "gear", quantity: 1, weight: 0, equipped: false, notes: "" }), x))}>
              + Add item
            </button>
          )
        }
      >
        {data.inventory.length === 0 ? (
          <p className="text-sm text-parchment-500">Your pack is empty.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase text-parchment-500">
              <tr>
                <th className="w-8">Eq</th>
                <th>Item</th>
                <th className="w-28">Type</th>
                <th className="w-16">Qty</th>
                <th className="w-16">Wt</th>
                {actions && <th className="w-10" />}
                {editable && <th className="w-6" />}
              </tr>
            </thead>
            <tbody>
              {data.inventory.map((it, i) => (
                <tr key={it.id} className="border-t border-ink-800">
                  <td>
                    <input type="checkbox" aria-label={`${it.name} equipped`} className="accent-gold-500" disabled={!editable} checked={it.equipped} onChange={(e) => setData((x) => ((x.inventory[i]!.equipped = e.target.checked), x))} />
                  </td>
                  <td>
                    <TextField label="Item name" value={it.name} disabled={!editable} onChange={(v) => setData((x) => ((x.inventory[i]!.name = v), x))} />
                  </td>
                  <td>
                    <select disabled={!editable} aria-label="Item type" value={it.category} onChange={(e) => setData((x) => ((x.inventory[i]!.category = e.target.value as (typeof ITEM_CATEGORIES)[number]), x))} className="w-full rounded bg-transparent text-xs">
                      {ITEM_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <NumberField label="Quantity" value={it.quantity} min={0} max={100000} disabled={!editable} onChange={(n) => setData((x) => ((x.inventory[i]!.quantity = n), x))} />
                  </td>
                  <td>
                    <NumberField label="Weight" value={it.weight} min={0} max={100000} disabled={!editable} onChange={(n) => setData((x) => ((x.inventory[i]!.weight = n), x))} />
                  </td>
                  {actions && (
                    <td>
                      <GiveButton item={it} actions={actions} />
                    </td>
                  )}
                  {editable && (
                    <td>
                      <button aria-label={`Remove ${it.name}`} className="text-blood-400" onClick={() => setData((x) => (x.inventory.splice(i, 1), x))}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-right text-xs text-parchment-500">Total weight: {totalWeight} lb</p>
      </Section>
      <Section title="Currency">
        <div className="grid grid-cols-5 gap-1 text-center text-xs">
          {(["cp", "sp", "ep", "gp", "pp"] as const).map((c) => (
            <label key={c}>
              <span className="uppercase text-parchment-500">{c}</span>
              <NumberField label={c} value={data.currency[c]} min={0} max={1e9} disabled={!editable} onChange={(n) => setData((x) => ((x.currency[c] = n), x))} />
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}

const FEATURE_SOURCES = ["class", "subclass", "species", "feat", "background", "homebrew", "other"] as const;

export function FeaturesSection({ data, editable, setData }: { data: CharacterData; editable: boolean; setData: SetData }) {
  return (
    <Section
      title="Features & traits"
      actions={
        editable && (
          <button className="text-xs text-gold-400 hover:underline" onClick={() => setData((x) => (x.features.push({ id: newId(), name: "New feature", source: "class", description: "", uses: null }), x))}>
            + Add feature
          </button>
        )
      }
    >
      {data.features.length === 0 && <p className="text-sm text-parchment-500">No features recorded.</p>}
      <ul className="space-y-2">
        {data.features.map((f, i) => (
          <li key={f.id} className="rounded border border-ink-700 bg-ink-850 p-2">
            <div className="flex items-center gap-2">
              <TextField label="Feature name" value={f.name} disabled={!editable} onChange={(v) => setData((x) => ((x.features[i]!.name = v), x))} className="flex-1 font-semibold" />
              <select disabled={!editable} aria-label="Feature source" value={f.source} onChange={(e) => setData((x) => ((x.features[i]!.source = e.target.value as (typeof FEATURE_SOURCES)[number]), x))} className="rounded bg-transparent text-xs text-parchment-400">
                {FEATURE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {f.uses ? (
                <span className="flex items-center gap-1 text-xs">
                  <NumberField label="Uses spent" value={f.uses.used} min={0} max={f.uses.max} disabled={!editable} onChange={(n) => setData((x) => ((x.features[i]!.uses = { max: f.uses!.max, used: n }), x))} className="w-10" />/
                  <NumberField label="Max uses" value={f.uses.max} min={0} max={99} disabled={!editable} onChange={(n) => setData((x) => ((x.features[i]!.uses = { max: n, used: Math.min(f.uses!.used, n) }), x))} className="w-10" />
                </span>
              ) : (
                editable && (
                  <button className="text-[10px] text-parchment-500 hover:text-gold-300" onClick={() => setData((x) => ((x.features[i]!.uses = { max: 1, used: 0 }), x))}>
                    + uses
                  </button>
                )
              )}
              {editable && (
                <button aria-label={`Remove ${f.name}`} className="text-blood-400" onClick={() => setData((x) => (x.features.splice(i, 1), x))}>
                  ✕
                </button>
              )}
            </div>
            {editable ? (
              <Textarea className="mt-1 min-h-16 text-sm" maxLength={5000} value={f.description} onChange={(e) => setData((x) => ((x.features[i]!.description = e.target.value), x))} placeholder="Description (your own words or SRD text)" />
            ) : (
              f.description && <p className="mt-1 whitespace-pre-wrap text-sm text-parchment-400">{f.description}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

const NOTE_FIELDS: Array<[keyof CharacterData["notes"], string]> = [
  ["description", "Appearance & description"],
  ["personality", "Personality traits"],
  ["ideals", "Ideals"],
  ["bonds", "Bonds"],
  ["flaws", "Flaws"],
  ["backstory", "Backstory"],
  ["goals", "Goals"],
  ["relationships", "Relationships"],
  ["quests", "Quest notes"],
  ["personal", "Personal notes"],
];

export function NotesSection({ data, editable, setData }: { data: CharacterData; editable: boolean; setData: SetData }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {NOTE_FIELDS.map(([key, label]) => (
        <Section key={key} title={label}>
          {editable ? (
            <Textarea maxLength={20000} value={data.notes[key]} onChange={(e) => setData((x) => ((x.notes[key] = e.target.value), x))} className="min-h-28 text-sm" />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-parchment-400">{data.notes[key] || "—"}</p>
          )}
        </Section>
      ))}
    </div>
  );
}

const OVERRIDES: Array<[keyof CharacterData["overrides"], string, number, number]> = [
  ["proficiencyBonus", "Proficiency bonus", 0, 20],
  ["initiative", "Initiative", -20, 50],
  ["passivePerception", "Passive Perception", 0, 60],
  ["spellSaveDc", "Spell save DC", 0, 50],
  ["spellAttackBonus", "Spell attack bonus", -20, 50],
];

export function OverridesSection({ data, editable, setData }: { data: CharacterData; editable: boolean; setData: SetData }) {
  return (
    <Section title="Manual overrides">
      <p className="mb-2 text-xs text-parchment-500">Leave blank to use the rules engine's calculation. Overridden values are marked on the sheet.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {OVERRIDES.map(([key, label, min, max]) => (
          <label key={key} className="text-xs">
            <span className="text-parchment-500">{label}</span>
            <input
              type="number"
              disabled={!editable}
              min={min}
              max={max}
              value={data.overrides[key] ?? ""}
              onChange={(e) =>
                setData((x) => {
                  if (e.target.value === "") delete x.overrides[key];
                  else x.overrides[key] = Math.max(min, Math.min(max, Number(e.target.value) | 0));
                  return x;
                })
              }
              className="mt-1 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-center disabled:border-transparent disabled:bg-transparent"
              placeholder="auto"
            />
          </label>
        ))}
      </div>
    </Section>
  );
}
