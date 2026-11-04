import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ABILITIES,
  CUSTOM_BACKGROUND,
  DND5E_2014,
  POINT_BUY_BUDGET,
  SRD_BACKGROUNDS,
  SRD_CLASSES,
  SRD_RACES,
  STANDARD_ARRAY,
  abilityModifier,
  buildSrdCharacter,
  defaultCreatorChoices,
  deriveCharacter,
  finalAbilities,
  fixedSkills,
  formatModifier,
  pointBuyCost,
  roll,
  validateCreatorChoices,
  type Ability,
  type AbilityMethod,
  type CreatorChoices,
} from "@vtt/rules";
import { Badge, Button, Card, Field, Input, Select, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { CharacterFull } from "../../lib/types";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";

const ruleset = DND5E_2014;
const skillName = (id: string) => ruleset.skills.find((s) => s.id === id)?.name ?? id;
const ALIGNMENTS = ["Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "True Neutral", "Chaotic Neutral", "Lawful Evil", "Neutral Evil", "Chaotic Evil"];

/**
 * Guided level-1 character creation for 5e (2014) from SRD 5.1 content. Every rule is
 * checked by `validateCreatorChoices` in @vtt/rules; the result is a normal character
 * that stays fully editable on the sheet.
 */
export function CreateCharacterPage() {
  const t = useT();
  const navigate = useNavigate();
  const [c, setC] = useState<CreatorChoices>(defaultCreatorChoices);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<CreatorChoices>) => setC((prev) => ({ ...prev, ...patch }));

  const race = SRD_RACES.find((r) => r.id === c.raceId)!;
  const cls = SRD_CLASSES.find((k) => k.id === c.classId)!;
  const bg = SRD_BACKGROUNDS.find((b) => b.id === c.backgroundId);
  const errors = useMemo(() => validateCreatorChoices(c, ruleset), [c]);
  const preview = useMemo(() => {
    if (errors.length) return null;
    const built = buildSrdCharacter(c, ruleset);
    return { ...built, derived: deriveCharacter(built.data, ruleset) };
  }, [c, errors]);
  const fixed = fixedSkills(c);
  const fin = finalAbilities(c);
  const classOptions = cls.skillOptions === "any" ? ruleset.skills.map((s) => s.id) : cls.skillOptions;

  // Changing race/class/background can invalidate skill picks; drop the ones that no longer fit.
  const pickRace = (raceId: string) => set({ raceId, freeBonusAbilities: [], raceSkills: [] });
  const pickClass = (classId: string) => set({ classId, classSkills: [] });
  const pickBackground = (backgroundId: string) => set({ backgroundId, classSkills: c.classSkills.filter((s) => !(SRD_BACKGROUNDS.find((b) => b.id === backgroundId)?.skills ?? []).includes(s)) });

  const setMethod = (method: AbilityMethod) => {
    const base =
      method === "pointbuy"
        ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }
        : method === "standard"
          ? { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
          : c.baseAbilities;
    set({ method, baseAbilities: base });
  };
  const setBase = (a: Ability, v: number) => set({ baseAbilities: { ...c.baseAbilities, [a]: v } });
  /** Standard array: choosing a value swaps it with the ability that had it, so each value stays used once. */
  const assignStandard = (a: Ability, v: number) => {
    const other = ABILITIES.find((x) => x !== a && c.baseAbilities[x] === v);
    set({ baseAbilities: { ...c.baseAbilities, [a]: v, ...(other ? { [other]: c.baseAbilities[a] } : {}) } });
  };
  const rollAll = () => {
    const out = { ...c.baseAbilities };
    for (const a of ABILITIES) out[a] = roll("4d6kh3").total;
    set({ baseAbilities: out });
  };
  const toggle = (list: string[], id: string, max: number) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list);

  const create = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const { character } = await api.post<{ character: CharacterFull }>("/api/characters", { name: preview.name, rulesetId: ruleset.id, data: preview.data });
      toast.success(t("create.saved", { name: character.name }));
      navigate(`/characters/${character.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const cost = pointBuyCost(c.baseAbilities);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" data-testid="creator">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to="/" className="text-sm text-gold-400 hover:underline">
            ← {t("create.back")}
          </Link>
          <h1 className="font-display text-2xl text-parchment-50">{t("create.title")}</h1>
          <p className="text-sm text-parchment-400">{t("create.subtitle")}</p>
        </div>
        <Badge tone="gold">D&D 5e (2014) · SRD 5.1</Badge>
      </div>

      <Step n={1} title={t("create.basics")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("create.name")}>
            <Input value={c.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} data-testid="creator-name" />
          </Field>
          <Field label="Alignment">
            <Select value={c.alignment} onChange={(e) => set({ alignment: e.target.value })} data-testid="creator-alignment">
              <option value="">—</option>
              {ALIGNMENTS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Step>

      <Step n={2} title="Race">
        <ChoiceGrid testid="creator-race" items={SRD_RACES.map((r) => ({ id: r.id, label: r.subrace ? `${r.name} (${r.subrace})` : r.name, sub: bonusText(r.bonuses, r.freeBonuses) }))} value={c.raceId} onChange={pickRace} />
        <Details>
          Speed {race.speed} ft{race.resistances?.length ? ` · Resistance: ${race.resistances.join(", ")}` : ""}
          {race.traits.length > 0 && <> · {race.traits.map((tr) => tr.name).join(", ")}</>}
        </Details>
        {race.freeBonuses ? (
          <div className="mt-2">
            <p className="mb-1 text-sm text-parchment-300">{t("create.freeBonus", { n: race.freeBonuses })}</p>
            <div className="flex flex-wrap gap-2">
              {ABILITIES.filter((a) => !(race.bonuses[a] ?? 0)).map((a) => (
                <Chip key={a} on={c.freeBonusAbilities.includes(a)} onClick={() => set({ freeBonusAbilities: toggle(c.freeBonusAbilities, a, race.freeBonuses!) as Ability[] })} testid={`creator-free-${a}`}>
                  {a.toUpperCase()} +1
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </Step>

      <Step n={3} title="Class">
        <ChoiceGrid testid="creator-class" items={SRD_CLASSES.map((k) => ({ id: k.id, label: k.name, sub: `d${k.hitDie} · ${k.saves.map((s) => s.toUpperCase()).join("/")}` }))} value={c.classId} onChange={pickClass} />
        <Details>
          Hit die d{cls.hitDie} · Saves {cls.saves.map((s) => s.toUpperCase()).join(", ")}
          {cls.spellAbility ? ` · Spellcasting ${cls.spellAbility.toUpperCase()}` : ""}
          {cls.subclassAtLevel1 ? ` · ${cls.subclassAtLevel1}` : ""} · {cls.features.map((f) => f.name).join(", ")}
        </Details>
      </Step>

      <Step n={4} title="Background">
        <ChoiceGrid
          testid="creator-background"
          items={[...SRD_BACKGROUNDS.map((b) => ({ id: b.id, label: b.name, sub: b.skills.map(skillName).join(", ") })), { id: CUSTOM_BACKGROUND, label: t("create.customBg"), sub: t("create.customBgSub") }]}
          value={c.backgroundId}
          onChange={pickBackground}
        />
        {bg && <Details>{bg.feature.name}: {bg.feature.description}</Details>}
        {c.backgroundId === CUSTOM_BACKGROUND && (
          <div className="mt-2 space-y-2">
            <Field label={t("create.customBgName")}>
              <Input value={c.customBackgroundName} maxLength={60} onChange={(e) => set({ customBackgroundName: e.target.value })} data-testid="creator-bg-name" />
            </Field>
            <p className="text-sm text-parchment-300">{t("create.pickSkills", { n: 2 })}</p>
            <SkillChips options={ruleset.skills.map((s) => s.id)} picked={c.customBackgroundSkills} disabled={[]} onToggle={(id) => set({ customBackgroundSkills: toggle(c.customBackgroundSkills, id, 2), classSkills: c.classSkills.filter((s) => s !== id) })} prefix="creator-bgskill" />
          </div>
        )}
      </Step>

      <Step n={5} title={t("create.abilities")}>
        <div className="mb-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("create.method")}>
          {(["standard", "pointbuy", "manual"] as const).map((m) => (
            <Chip key={m} on={c.method === m} onClick={() => setMethod(m)} testid={`creator-method-${m}`}>
              {t(`create.method.${m}`)}
            </Chip>
          ))}
          {c.method === "pointbuy" && (
            <span className={cx("text-sm", cost !== null && cost <= POINT_BUY_BUDGET ? "text-parchment-300" : "text-blood-400")} data-testid="creator-points">
              {t("create.points", { used: cost ?? "?", max: POINT_BUY_BUDGET })}
            </span>
          )}
          {c.method === "manual" && (
            <Button size="sm" variant="ghost" onClick={rollAll} data-testid="creator-roll">
              🎲 {t("create.roll4d6")}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITIES.map((a) => (
            <div key={a} className="rounded-lg border border-ink-700 bg-ink-900/60 p-2 text-center">
              <div className="text-xs font-semibold text-parchment-400">{a.toUpperCase()}</div>
              {c.method === "standard" ? (
                <Select value={c.baseAbilities[a]} onChange={(e) => assignStandard(a, Number(e.target.value))} aria-label={`${a} base`} data-testid={`creator-base-${a}`}>
                  {STANDARD_ARRAY.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  type="number"
                  min={c.method === "pointbuy" ? 8 : 3}
                  max={c.method === "pointbuy" ? 15 : 18}
                  value={c.baseAbilities[a]}
                  onChange={(e) => setBase(a, Math.trunc(Number(e.target.value) || 0))}
                  aria-label={`${a} base`}
                  data-testid={`creator-base-${a}`}
                  className="text-center"
                />
              )}
              <div className="mt-1 text-lg text-parchment-50" data-testid={`creator-final-${a}`}>
                {fin[a]} <span className="text-sm text-parchment-400">({formatModifier(abilityModifier(fin[a]))})</span>
              </div>
              {fin[a] !== c.baseAbilities[a] && <div className="text-xs text-gold-400">+{fin[a] - c.baseAbilities[a]}</div>}
            </div>
          ))}
        </div>
      </Step>

      <Step n={6} title={t("create.skills")}>
        {fixed.length > 0 && <p className="mb-2 text-sm text-parchment-400">{t("create.fixedSkills")}: {fixed.map(skillName).join(", ")}</p>}
        <p className="mb-1 text-sm text-parchment-300">
          {cls.name}: {t("create.pickSkills", { n: cls.skillCount })} ({c.classSkills.length}/{cls.skillCount})
        </p>
        <SkillChips options={classOptions} picked={c.classSkills} disabled={fixed} onToggle={(id) => set({ classSkills: toggle(c.classSkills, id, cls.skillCount) })} prefix="creator-skill" />
        {race.skillChoices ? (
          <>
            <p className="mb-1 mt-3 text-sm text-parchment-300">
              {race.name}: {t("create.pickSkills", { n: race.skillChoices })} ({c.raceSkills.length}/{race.skillChoices})
            </p>
            <SkillChips options={ruleset.skills.map((s) => s.id)} picked={c.raceSkills} disabled={[...fixed, ...c.classSkills]} onToggle={(id) => set({ raceSkills: toggle(c.raceSkills, id, race.skillChoices!) })} prefix="creator-raceskill" />
          </>
        ) : null}
      </Step>

      <Step n={7} title={t("create.review")}>
        {preview ? (
          <div className="grid gap-2 text-sm text-parchment-200 sm:grid-cols-4" data-testid="creator-preview">
            <Stat label="HP" value={preview.data.hp.max} testid="creator-hp" />
            <Stat label="AC" value={preview.data.armorClass} testid="creator-ac" />
            <Stat label="Initiative" value={formatModifier(preview.derived.initiative.value)} />
            <Stat label="Speed" value={`${preview.data.speed} ft`} />
            <p className="sm:col-span-4">
              {preview.data.species} {preview.data.classes[0]!.name} 1 · {preview.data.background} · Proficiency +{preview.derived.proficiencyBonus.value} ·{" "}
              {t("create.skills")}: {Object.keys(preview.data.skills).map(skillName).join(", ")}
            </p>
            <p className="text-xs text-parchment-500 sm:col-span-4">{t("create.equipmentNote")}</p>
          </div>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-blood-300" data-testid="creator-errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <Button onClick={create} disabled={!preview || saving} data-testid="creator-create">
            {saving ? t("create.saving") : t("create.create")}
          </Button>
        </div>
      </Step>
      <p className="text-xs text-parchment-500">{ruleset.attribution}</p>
    </div>
  );
}

function bonusText(b: Partial<Record<Ability, number>>, free?: number) {
  const parts = Object.entries(b).map(([a, v]) => `${a.toUpperCase()} +${v}`);
  if (free) parts.push(`+1 ×${free}`);
  return parts.length === 6 ? "All +1" : parts.join(", ");
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card title={<span><span className="mr-2 text-gold-400">{n}.</span>{title}</span>}>
      {children}
    </Card>
  );
}

function Details({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm text-parchment-400">{children}</p>;
}

function Stat({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-2 text-center">
      <div className="text-xs text-parchment-400">{label}</div>
      <div className="text-xl text-parchment-50" data-testid={testid}>
        {value}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children, testid, disabled }: { on: boolean; onClick: () => void; children: ReactNode; testid?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      data-testid={testid}
      className={cx(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        on ? "border-gold-400 bg-gold-500/20 text-gold-200" : "border-ink-600 text-parchment-300 hover:border-gold-600/60",
        disabled && "cursor-not-allowed opacity-40 hover:border-ink-600",
      )}
    >
      {children}
    </button>
  );
}

function ChoiceGrid({ items, value, onChange, testid }: { items: Array<{ id: string; label: string; sub?: string }>; value: string; onChange: (id: string) => void; testid: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" data-testid={testid}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={value === it.id}
          onClick={() => onChange(it.id)}
          data-testid={`${testid}-${it.id}`}
          className={cx("rounded-lg border p-2 text-left", value === it.id ? "border-gold-400 bg-gold-500/10" : "border-ink-700 bg-ink-900/60 hover:border-gold-600/60")}
        >
          <div className="text-sm font-semibold text-parchment-100">{it.label}</div>
          {it.sub && <div className="text-xs text-parchment-400">{it.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function SkillChips({ options, picked, disabled, onToggle, prefix }: { options: string[]; picked: string[]; disabled: string[]; onToggle: (id: string) => void; prefix: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((id) => {
        const off = disabled.includes(id) && !picked.includes(id);
        return (
          <Chip key={id} on={picked.includes(id) || disabled.includes(id)} disabled={off} onClick={() => onToggle(id)} testid={`${prefix}-${id}`}>
            {skillName(id)}
          </Chip>
        );
      })}
    </div>
  );
}
