import { useMemo, useState } from "react";
import {
  ABILITIES,
  deriveCharacter,
  getBuiltinRuleset,
  type Ability,
  type CharacterData,
  type ProficiencyLevel,
  type RollMode,
  type RulesetDefinition,
} from "@vtt/rules";
import type { CharacterFull } from "../../lib/types";
import { Avatar } from "../../components/Avatar";
import { cx } from "../../components/ui";
import { combineModes, mod, newId } from "./format";
import { NumberField, RollButton, Section, SourceTag, TextField } from "./fields";
import { AttacksSection, CombatSection, ConditionsSection } from "./CombatSections";
import { FeaturesSection, InventorySection, NotesSection, OverridesSection, SpellsSection } from "./ListSections";
import type { SheetActions } from "./SpellActions";

export interface SheetRoll {
  formula: string;
  mode?: RollMode;
  label: string;
  rollType: string;
}

export interface SheetProps {
  character: CharacterFull;
  editable: boolean;
  onChange: (patch: { name?: string; data?: CharacterData }) => void;
  onRoll?: (r: SheetRoll) => Promise<unknown>;
  rollTarget: "campaign" | "local";
  /** Set when the sheet is open at a table and may cast spells / give items there. */
  actions?: SheetActions;
}

export type SetData = (fn: (d: CharacterData) => CharacterData) => void;

const TABS = ["Main", "Combat", "Spells", "Inventory", "Features", "Notes"] as const;
/** The sheet remounts when the server changes the character; remember the tab across that. */
const lastTab = new Map<string, (typeof TABS)[number]>();

export function CharacterSheet({ character, editable, onChange, onRoll, rollTarget, actions }: SheetProps) {
  const ruleset = getBuiltinRuleset(character.rulesetId);
  const [tab, setTabState] = useState<(typeof TABS)[number]>(() => lastTab.get(character.id) ?? "Main");
  const setTab = (t: (typeof TABS)[number]) => {
    lastTab.set(character.id, t);
    setTabState(t);
  };
  const [mode, setMode] = useState<RollMode>("normal");
  const data = character.data;
  const derived = useMemo(() => (ruleset ? deriveCharacter(data, ruleset) : null), [data, ruleset]);
  if (!ruleset || !derived) return <p className="text-blood-400">Unknown ruleset {character.rulesetId}</p>;

  const setData: SetData = (fn) => onChange({ data: fn(structuredClone(data)) });
  const roll = onRoll
    ? (formula: string, label: string, rollType: string, d20 = true, extra?: RollMode) =>
        void onRoll({ formula, label, rollType, mode: d20 ? combineModes(mode, extra) : "normal" })
    : undefined;
  const d20 = (bonus: number) => `1d20${bonus >= 0 ? "+" : ""}${bonus}`;

  return (
    <div className="space-y-3">
      <Header character={character} editable={editable} onChange={onChange} setData={setData} derived={derived} ruleset={ruleset} />

      {derived.warnings.length > 0 && (
        <ul className="rounded-md border border-gold-600/40 bg-gold-500/10 px-3 py-2 text-xs text-gold-300">
          {derived.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx("rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-ink-700 text-gold-300" : "text-parchment-400 hover:bg-ink-800")}
            >
              {t}
            </button>
          ))}
        </div>
        {roll && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-parchment-500">{rollTarget === "campaign" ? "Rolls go to the table" : "Rolls stay on this page"} ·</span>
            {(["disadvantage", "normal", "advantage"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cx("rounded px-2 py-1 capitalize", mode === m ? "bg-ink-700 text-parchment-50" : "text-parchment-500 hover:text-parchment-200")}
              >
                {m === "normal" ? "Normal" : m === "advantage" ? "Adv" : "Dis"}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "Main" && (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-3">
            <AbilitiesSection data={data} ruleset={ruleset} derived={derived} editable={editable} setData={setData} roll={roll} d20={d20} />
            <QuickStats derived={derived} roll={roll} d20={d20} />
          </div>
          <SkillsSection data={data} derived={derived} editable={editable} setData={setData} roll={roll} d20={d20} />
        </div>
      )}
      {tab === "Combat" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <CombatSection data={data} derived={derived} ruleset={ruleset} editable={editable} setData={setData} roll={roll} d20={d20} />
          <div className="space-y-3">
            <ConditionsSection data={data} ruleset={ruleset} editable={editable} setData={setData} />
            <AttacksSection data={data} derived={derived} editable={editable} setData={setData} roll={roll} d20={d20} />
          </div>
        </div>
      )}
      {tab === "Spells" && <SpellsSection data={data} derived={derived} editable={editable} setData={setData} roll={roll} d20={d20} actions={actions} />}
      {tab === "Inventory" && <InventorySection data={data} editable={editable} setData={setData} actions={actions} />}
      {tab === "Features" && <FeaturesSection data={data} editable={editable} setData={setData} />}
      {tab === "Notes" && (
        <div className="space-y-3">
          <NotesSection data={data} editable={editable} setData={setData} />
          <OverridesSection data={data} editable={editable} setData={setData} />
        </div>
      )}
    </div>
  );
}

type Derived = ReturnType<typeof deriveCharacter>;
type Roll = ((formula: string, label: string, rollType: string, d20?: boolean, extra?: RollMode) => void) | undefined;

function Header({
  character,
  editable,
  onChange,
  setData,
  derived,
  ruleset,
}: {
  character: CharacterFull;
  editable: boolean;
  onChange: SheetProps["onChange"];
  setData: SetData;
  derived: Derived;
  ruleset: RulesetDefinition;
}) {
  const d = character.data;
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-ink-700 bg-ink-900/50 p-3 md:flex-row">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <Avatar name={character.name || "?"} url={d.portraitUrl} color={d.color} size={88} />
        {editable && (
          <input
            type="color"
            aria-label="Character color"
            value={d.color}
            onChange={(e) => setData((x) => ({ ...x, color: e.target.value }))}
            className="h-6 w-16 cursor-pointer rounded border border-ink-600 bg-transparent"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <TextField
            label="Character name"
            value={character.name}
            disabled={!editable}
            maxLength={100}
            onChange={(name) => onChange({ name })}
            className="max-w-sm font-display text-xl"
          />
          <span className="text-xs text-parchment-500">
            {ruleset.name} · Level {derived.totalLevel} · PB {mod(derived.proficiencyBonus.value)}
            <SourceTag source={derived.proficiencyBonus.source} />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <LabeledText label="Species" value={d.species} editable={editable} onChange={(v) => setData((x) => ({ ...x, species: v }))} />
          <LabeledText label="Background" value={d.background} editable={editable} onChange={(v) => setData((x) => ({ ...x, background: v }))} />
          <LabeledText label="Alignment" value={d.alignment} editable={editable} onChange={(v) => setData((x) => ({ ...x, alignment: v }))} />
          <LabeledText label="Player" value={d.playerName} editable={editable} onChange={(v) => setData((x) => ({ ...x, playerName: v }))} />
        </div>
        <ClassesEditor data={d} editable={editable} setData={setData} />
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <span className="text-[10px] uppercase text-parchment-500">XP</span>
            <NumberField label="Experience points" value={d.xp} min={0} max={10_000_000} disabled={!editable} onChange={(xp) => setData((x) => ({ ...x, xp }))} />
            {derived.nextLevelXp !== null && <span className="text-[10px] text-parchment-500">next level at {derived.nextLevelXp.toLocaleString()}</span>}
          </div>
          {editable && (
            <div className="col-span-2 sm:col-span-3">
              <span className="text-[10px] uppercase text-parchment-500">Portrait URL (https)</span>
              <TextField label="Portrait URL" value={d.portraitUrl} maxLength={500} placeholder="https://…" onChange={(v) => setData((x) => ({ ...x, portraitUrl: v.trim() }))} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LabeledText({ label, value, editable, onChange }: { label: string; value: string; editable: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="text-[10px] uppercase text-parchment-500">{label}</span>
      <TextField label={label} value={value} disabled={!editable} onChange={onChange} maxLength={60} placeholder="—" />
    </div>
  );
}

function ClassesEditor({ data, editable, setData }: { data: CharacterData; editable: boolean; setData: SetData }) {
  return (
    <div>
      <span className="text-[10px] uppercase text-parchment-500">Classes</span>
      <div className="space-y-1">
        {data.classes.length === 0 && !editable && <p className="text-sm text-parchment-500">No class yet.</p>}
        {data.classes.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_64px_72px_auto] items-center gap-1 text-sm">
            <TextField label="Class" value={c.name} disabled={!editable} maxLength={60} onChange={(v) => setData((x) => ((x.classes[i]!.name = v), x))} placeholder="Class" />
            <TextField label="Subclass" value={c.subclass} disabled={!editable} maxLength={60} onChange={(v) => setData((x) => ((x.classes[i]!.subclass = v), x))} placeholder="Subclass" />
            <NumberField label="Class level" value={c.level} min={1} max={20} disabled={!editable} onChange={(n) => setData((x) => ((x.classes[i]!.level = n), x))} />
            <select
              aria-label="Hit die"
              disabled={!editable}
              value={c.hitDie}
              onChange={(e) => setData((x) => ((x.classes[i]!.hitDie = Number(e.target.value) as 6 | 8 | 10 | 12), x))}
              className="rounded border border-ink-600 bg-ink-900 px-1 py-1 text-parchment-50 disabled:border-transparent disabled:bg-transparent"
            >
              {[6, 8, 10, 12].map((h) => (
                <option key={h} value={h}>
                  d{h}
                </option>
              ))}
            </select>
            {editable ? (
              <button className="px-1 text-blood-400" aria-label="Remove class" onClick={() => setData((x) => (x.classes.splice(i, 1), x))}>
                ✕
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {editable && (
          <button
            className="text-xs text-gold-400 hover:underline disabled:opacity-50"
            disabled={data.classes.length >= 10}
            onClick={() => setData((x) => (x.classes.push({ name: x.classes.length ? "" : "Fighter", subclass: "", level: 1, hitDie: 10 }), x))}
          >
            + Add class
          </button>
        )}
      </div>
    </div>
  );
}

function AbilitiesSection({
  data,
  ruleset,
  derived,
  editable,
  setData,
  roll,
  d20,
}: {
  data: CharacterData;
  ruleset: RulesetDefinition;
  derived: Derived;
  editable: boolean;
  setData: SetData;
  roll: Roll;
  d20: (n: number) => string;
}) {
  return (
    <Section title="Abilities & saving throws">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
        {ruleset.abilities.map((a) => {
          const m = derived.abilityModifiers[a.id];
          const save = derived.savingThrows[a.id];
          return (
            <div key={a.id} className="rounded-md border border-ink-700 bg-ink-850 p-2 text-center">
              <p className="text-[10px] font-bold tracking-widest text-parchment-400">{a.short}</p>
              <RollButton value={mod(m)} title={`${a.name} check`} onRoll={roll && (() => roll(d20(m - derived.d20Penalty), `${a.name} check`, "check"))} className="text-2xl font-display" />
              <NumberField
                label={`${a.name} score`}
                value={data.abilities[a.id]}
                min={ruleset.abilityScore.min}
                max={ruleset.abilityScore.max}
                disabled={!editable}
                onChange={(n) => setData((x) => ((x.abilities[a.id] = n), x))}
                className="mt-1 text-sm"
              />
              <div className="mt-2 flex items-center justify-center gap-1 border-t border-ink-700 pt-1 text-xs">
                <input
                  type="checkbox"
                  aria-label={`${a.name} save proficiency`}
                  className="accent-gold-500"
                  disabled={!editable}
                  checked={save.proficient}
                  onChange={(e) => setData((x) => toggleSave(x, a.id, e.target.checked))}
                />
                <span className="text-parchment-500">Save</span>
                <RollButton value={mod(save.value)} title={`${a.name} saving throw`} onRoll={roll && (() => roll(d20(save.value), `${a.name} save`, "save"))} />
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function toggleSave(x: CharacterData, a: Ability, on: boolean): CharacterData {
  const set = new Set(x.saveProficiencies);
  if (on) set.add(a);
  else set.delete(a);
  x.saveProficiencies = ABILITIES.filter((id) => set.has(id));
  return x;
}

function QuickStats({ derived, roll, d20 }: { derived: Derived; roll: Roll; d20: (n: number) => string }) {
  const stats: Array<[string, string, (() => void) | undefined, "computed" | "override"]> = [
    ["Initiative", mod(derived.initiative.value), roll && (() => roll(d20(derived.initiative.value), "Initiative", "initiative")), derived.initiative.source],
    ["Passive Perception", String(derived.passivePerception.value), undefined, derived.passivePerception.source],
    ["Speed", `${derived.speed} ft`, undefined, "computed"],
    ["Proficiency", mod(derived.proficiencyBonus.value), undefined, derived.proficiencyBonus.source],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map(([label, value, onRoll, source]) => (
        <div key={label} className="rounded-md border border-ink-700 bg-ink-900/50 p-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-parchment-500">{label}</p>
          <RollButton value={value} title={label} onRoll={onRoll} className="text-lg" />
          <SourceTag source={source} />
        </div>
      ))}
      {derived.d20Penalty > 0 && <p className="col-span-full text-xs text-blood-400">Exhaustion: −{derived.d20Penalty} to all d20 tests (already included).</p>}
    </div>
  );
}

const PROF_CYCLE: ProficiencyLevel[] = ["none", "proficient", "expertise", "half"];
const PROF_ICON: Record<ProficiencyLevel, string> = { none: "○", half: "◐", proficient: "●", expertise: "◉" };

function SkillsSection({ data, derived, editable, setData, roll, d20 }: { data: CharacterData; derived: Derived; editable: boolean; setData: SetData; roll: Roll; d20: (n: number) => string }) {
  return (
    <Section title="Skills" actions={<span className="text-[10px] text-parchment-500">○ none ● proficient ◉ expertise ◐ half</span>}>
      <ul className="grid gap-x-4 sm:grid-cols-2">
        {derived.skills.map((s) => (
          <li key={s.id} className="flex items-center gap-2 border-b border-ink-800 py-1 text-sm">
            <button
              type="button"
              disabled={!editable}
              aria-label={`${s.name} proficiency: ${s.proficiency}`}
              title={s.proficiency}
              className={cx("w-5 text-center", s.proficiency === "none" ? "text-parchment-500" : "text-gold-400")}
              onClick={() =>
                setData((x) => {
                  const next = PROF_CYCLE[(PROF_CYCLE.indexOf(s.proficiency) + 1) % PROF_CYCLE.length]!;
                  if (next === "none") delete x.skills[s.id];
                  else x.skills[s.id] = next;
                  return x;
                })
              }
            >
              {PROF_ICON[s.proficiency]}
            </button>
            <span className="flex-1 truncate">
              {s.name} <span className="text-[10px] uppercase text-parchment-500">{s.ability}</span>
            </span>
            {editable ? (
              <select
                aria-label={`${s.name} default roll mode`}
                value={data.skillRollModes[s.id] ?? ""}
                onChange={(e) =>
                  setData((x) => {
                    if (e.target.value) x.skillRollModes[s.id] = e.target.value as "advantage" | "disadvantage";
                    else delete x.skillRollModes[s.id];
                    return x;
                  })
                }
                className="w-12 rounded bg-transparent text-[10px] text-parchment-500"
              >
                <option value="">—</option>
                <option value="advantage">Adv</option>
                <option value="disadvantage">Dis</option>
              </select>
            ) : (
              s.rollMode !== "normal" && <span className="text-[10px] text-arcane-400">{s.rollMode === "advantage" ? "Adv" : "Dis"}</span>
            )}
            <RollButton value={mod(s.value)} title={`${s.name} check`} onRoll={roll && (() => roll(d20(s.value), s.name, "skill", true, s.rollMode))} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export { newId };

