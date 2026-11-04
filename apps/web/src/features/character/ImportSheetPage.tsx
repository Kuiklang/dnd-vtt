import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ABILITIES,
  deriveCharacter,
  formatModifier,
  getBuiltinRuleset,
  sheetToCharacterData,
  type Ability,
  type ExtractedSheet,
} from "@vtt/rules";
import { Button, Card, ErrorBanner, Field, Input, Loading, Select, Textarea, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { postMultipart } from "../../lib/upload";
import type { CharacterFull } from "../../lib/types";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Import a character from a PDF or a photo of a sheet. The server reads it (Claude API)
 * into a draft; the user reviews and corrects every field here before anything is saved.
 */
export function ImportSheetPage() {
  const t = useT();
  const navigate = useNavigate();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [rulesetId, setRulesetId] = useState("dnd5e-2014");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExtractedSheet | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ available: boolean }>("/api/characters/import/sheet")
      .then((r) => setAvailable(r.available))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const ruleset = getBuiltinRuleset(rulesetId);
  const mapped = useMemo(() => (draft && ruleset ? sheetToCharacterData(draft, ruleset) : null), [draft, ruleset]);
  const derived = useMemo(() => (mapped && ruleset ? deriveCharacter(mapped.data, ruleset) : null), [mapped, ruleset]);

  const read = async () => {
    if (!file) return;
    if (file.size > MAX_BYTES) return setError(t("import.tooLarge"));
    setReading(true);
    setError(null);
    try {
      const res = await postMultipart<{ draft: ExtractedSheet }>("/api/characters/import/sheet", { rulesetId }, file);
      setDraft(res.draft);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    if (!mapped) return;
    setSaving(true);
    try {
      const { character } = await api.post<{ character: CharacterFull }>("/api/characters", { name: mapped.name, rulesetId, data: mapped.data });
      toast.success(t("import.saved", { name: character.name }));
      navigate(`/characters/${character.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (available === null && !error) return <Loading />;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-parchment-400 hover:text-parchment-100">
          ← {t("common.back")}
        </Link>
        <h1 className="font-display text-2xl text-gold-400">{t("import.title")}</h1>
      </div>

      {available === false && (
        <div className="rounded-lg border border-gold-600/50 bg-gold-500/10 p-4 text-sm text-parchment-100" data-testid="import-unavailable">
          <p className="font-semibold text-gold-300">{t("import.unavailableTitle")}</p>
          <p className="mt-1 text-parchment-300">{t("import.unavailableBody")}</p>
        </div>
      )}

      {!draft && (
        <Card title={t("import.step1")}>
          <div className="space-y-3 text-sm">
            <p className="text-parchment-300">{t("import.intro")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("import.ruleset")}>
                <Select value={rulesetId} onChange={(e) => setRulesetId(e.target.value)}>
                  <option value="dnd5e-2014">D&amp;D 5e (2014)</option>
                  <option value="dnd5e-2024">D&amp;D 5e (2024)</option>
                </Select>
              </Field>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                data-testid="sheet-file"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
              <Button onClick={() => fileRef.current?.click()} disabled={!available}>
                {file ? t("import.changeFile") : t("import.chooseFile")}
              </Button>
              {file && <span className="truncate text-parchment-300">{file.name}</span>}
              <Button variant="primary" onClick={read} disabled={!available || !file} loading={reading} data-testid="read-sheet">
                {t("import.read")}
              </Button>
            </div>
            {reading && <p className="text-parchment-400">{t("import.reading")}</p>}
            <p className="text-xs text-parchment-500">{t("import.privacy")}</p>
          </div>
        </Card>
      )}

      {error && <ErrorBanner message={error} />}

      {draft && mapped && derived && ruleset && (
        <Review draft={draft} setDraft={setDraft} notes={mapped.notes} derived={derived} rulesetId={rulesetId} onBack={() => setDraft(null)} onSave={save} saving={saving} />
      )}
    </div>
  );
}

type Derived = ReturnType<typeof deriveCharacter>;

function Review({
  draft,
  setDraft,
  notes,
  derived,
  rulesetId,
  onBack,
  onSave,
  saving,
}: {
  draft: ExtractedSheet;
  setDraft(d: ExtractedSheet): void;
  notes: string[];
  derived: Derived;
  rulesetId: string;
  onBack(): void;
  onSave(): void;
  saving: boolean;
}) {
  const t = useT();
  const ruleset = getBuiltinRuleset(rulesetId)!;
  const unsure = new Set(draft.uncertainFields);
  const flag = (path: string) => unsure.has(path) || [...unsure].some((u) => u.startsWith(`${path}.`));
  const set = <K extends keyof ExtractedSheet>(k: K, v: ExtractedSheet[K]) => setDraft({ ...draft, [k]: v });
  const num = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
  const skillLevel = (id: string, name: string) => draft.skillProficiencies.find((s) => s.skill === id || s.skill.toLowerCase() === name.toLowerCase())?.level ?? "none";

  return (
    <div className="space-y-4" data-testid="import-review">
      <div className="rounded-lg border border-sky-700/50 bg-sky-900/20 p-3 text-sm text-parchment-200">
        <p>{t("import.reviewHint")}</p>
        {draft.uncertainFields.length > 0 && (
          <p className="mt-1 text-gold-300" data-testid="uncertain-count">
            {t("import.uncertain", { n: draft.uncertainFields.length })}
          </p>
        )}
        {[...draft.warnings, ...notes].map((w, i) => (
          <p key={i} className="mt-1 text-xs text-parchment-400">
            • {w}
          </p>
        ))}
      </div>

      <Card title={t("import.basics")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label={t("common.name")} unsure={flag("name")}>
            <Input value={draft.name} maxLength={100} onChange={(e) => set("name", e.target.value)} data-testid="import-name" />
          </F>
          <F label={t("import.player")} unsure={flag("playerName")}>
            <Input value={draft.playerName ?? ""} maxLength={60} onChange={(e) => set("playerName", e.target.value)} />
          </F>
          <F label="Species" unsure={flag("species")}>
            <Input value={draft.species ?? ""} maxLength={60} onChange={(e) => set("species", e.target.value)} />
          </F>
          <F label="Background" unsure={flag("background")}>
            <Input value={draft.background ?? ""} maxLength={60} onChange={(e) => set("background", e.target.value)} />
          </F>
        </div>
        <div className="mt-3 space-y-2">
          {draft.classes.map((c, i) => (
            <div key={i} className={cx("flex flex-wrap items-end gap-2", flag(`classes.${i}`) && "rounded ring-1 ring-gold-500/70")}>
              <F label="Class">
                <Input value={c.name} onChange={(e) => set("classes", draft.classes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </F>
              <F label="Subclass">
                <Input value={c.subclass ?? ""} onChange={(e) => set("classes", draft.classes.map((x, j) => (j === i ? { ...x, subclass: e.target.value } : x)))} />
              </F>
              <F label="Level">
                <Input type="number" className="w-20" min={1} max={ruleset.maxLevel} value={c.level} onChange={(e) => set("classes", draft.classes.map((x, j) => (j === i ? { ...x, level: num(e.target.value) ?? 1 } : x)))} />
              </F>
              <Button size="sm" variant="ghost" onClick={() => set("classes", draft.classes.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set("classes", [...draft.classes, { name: "", subclass: null, level: 1 }])}>
            + Class
          </Button>
        </div>
      </Card>

      <Card title={t("import.abilities")}>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {ABILITIES.map((a: Ability) => (
            <F key={a} label={a.toUpperCase()} unsure={flag(`abilities.${a}`)}>
              <Input
                type="number"
                min={1}
                max={30}
                value={draft.abilities[a] ?? ""}
                data-testid={`import-ability-${a}`}
                onChange={(e) => set("abilities", { ...draft.abilities, [a]: num(e.target.value) })}
              />
              <span className="text-xs text-parchment-400">{formatModifier(derived.abilityModifiers[a])}</span>
            </F>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="text-xs uppercase text-parchment-400">{t("rolls.saves")}:</span>
          {ABILITIES.map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.savingThrowProficiencies.includes(a)}
                onChange={(e) =>
                  set("savingThrowProficiencies", e.target.checked ? [...draft.savingThrowProficiencies, a] : draft.savingThrowProficiencies.filter((x) => x !== a))
                }
              />
              {a.toUpperCase()} {formatModifier(derived.savingThrows[a].value)}
            </label>
          ))}
        </div>
      </Card>

      <Card title={t("import.combat")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ["armorClass", "AC"],
              ["maxHp", "Max HP"],
              ["currentHp", "Current HP"],
              ["speed", "Speed"],
              ["xp", "XP"],
            ] as const
          ).map(([k, label]) => (
            <F key={k} label={label} unsure={flag(k)}>
              <Input type="number" value={draft[k] ?? ""} onChange={(e) => set(k, num(e.target.value))} data-testid={`import-${k}`} />
            </F>
          ))}
        </div>
        <p className="mt-2 text-xs text-parchment-400">
          {t("import.preview", { pb: formatModifier(derived.proficiencyBonus.value), init: formatModifier(derived.initiative.value), pp: derived.passivePerception.value })}
        </p>
      </Card>

      <Card title={t("import.skills")}>
        <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {ruleset.skills.map((s) => (
            <label key={s.id} className="flex items-center justify-between gap-2">
              <span className={cx(flag(`skillProficiencies`) && "text-gold-200")}>{s.name}</span>
              <Select
                className="h-7 w-28 text-xs"
                value={skillLevel(s.id, s.name)}
                onChange={(e) => {
                  const rest = draft.skillProficiencies.filter((x) => x.skill !== s.id && x.skill.toLowerCase() !== s.name.toLowerCase());
                  const v = e.target.value as "none" | "proficient" | "expertise";
                  set("skillProficiencies", v === "none" ? rest : [...rest, { skill: s.id, level: v }]);
                }}
              >
                <option value="none">—</option>
                <option value="proficient">Proficient</option>
                <option value="expertise">Expertise</option>
              </Select>
            </label>
          ))}
        </div>
      </Card>

      <Card title={t("import.attacks")}>
        <div className="space-y-2">
          {draft.attacks.map((a, i) => (
            <div key={i} className={cx("flex flex-wrap items-end gap-2", flag(`attacks.${i}`) && "rounded ring-1 ring-gold-500/70")}>
              <F label={t("common.name")}>
                <Input value={a.name} onChange={(e) => set("attacks", draft.attacks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </F>
              <F label="To hit">
                <Input type="number" className="w-20" value={a.attackBonus ?? ""} onChange={(e) => set("attacks", draft.attacks.map((x, j) => (j === i ? { ...x, attackBonus: num(e.target.value) } : x)))} />
              </F>
              <F label="Damage">
                <Input className="w-28" value={a.damage ?? ""} onChange={(e) => set("attacks", draft.attacks.map((x, j) => (j === i ? { ...x, damage: e.target.value } : x)))} />
              </F>
              <F label="Type">
                <Input className="w-28" value={a.damageType ?? ""} onChange={(e) => set("attacks", draft.attacks.map((x, j) => (j === i ? { ...x, damageType: e.target.value } : x)))} />
              </F>
              <Button size="sm" variant="ghost" onClick={() => set("attacks", draft.attacks.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set("attacks", [...draft.attacks, { name: "", attackBonus: null, damage: null, damageType: null }])}>
            + Attack
          </Button>
        </div>
      </Card>

      <Card title={t("import.lists")}>
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <NameList title={t("import.features", { n: draft.features.length })} items={draft.features.map((f) => f.name)} onRemove={(i) => set("features", draft.features.filter((_, j) => j !== i))} />
          <NameList title={t("import.spells", { n: draft.spells.length })} items={draft.spells.map((s) => `${s.name} (${s.level})`)} onRemove={(i) => set("spells", draft.spells.filter((_, j) => j !== i))} />
          <NameList
            title={t("import.items", { n: draft.inventory.length })}
            items={draft.inventory.map((s) => (s.quantity && s.quantity > 1 ? `${s.name} ×${s.quantity}` : s.name))}
            onRemove={(i) => set("inventory", draft.inventory.filter((_, j) => j !== i))}
          />
        </div>
        <F label={t("import.backstory")} unsure={flag("notes")}>
          <Textarea rows={3} value={draft.notes.backstory ?? ""} onChange={(e) => set("notes", { ...draft.notes, backstory: e.target.value })} />
        </F>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t("import.startOver")}
        </Button>
        <Button variant="primary" onClick={onSave} loading={saving} data-testid="import-save">
          {t("import.save")}
        </Button>
      </div>
    </div>
  );
}

function F({ label, unsure, children }: { label: string; unsure?: boolean; children: ReactNode }) {
  return (
    <div className={cx("rounded", unsure && "bg-gold-500/10 ring-1 ring-gold-500/70")} data-uncertain={unsure || undefined}>
      <Field label={unsure ? `${label} ⚠` : label}>{children}</Field>
    </div>
  );
}

function NameList({ title, items, onRemove }: { title: string; items: string[]; onRemove(i: number): void }) {
  return (
    <div>
      <p className="mb-1 text-xs uppercase text-parchment-400">{title}</p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto">
        {items.map((name, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="truncate">{name}</span>
            <button type="button" className="text-xs text-parchment-500 hover:text-blood-400" onClick={() => onRemove(i)} aria-label="Remove">
              ✕
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-parchment-500">—</li>}
      </ul>
    </div>
  );
}
