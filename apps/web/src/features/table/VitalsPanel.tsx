import { useEffect, useRef, useState } from "react";
import { HP_VISIBILITY, type HpAction, type HpState, type HpVisibility, type RulesetDefinition, type TokenCondition } from "@vtt/rules";
import { Button, Field, Input, Select, cx } from "../../components/ui";
import { useT } from "../../i18n";
import type { Combat } from "./useCombat";
import type { Table } from "./useTable";
import type { TokenDto, TokenStats } from "./types";

/** Green → amber → red HP bar; temp HP shown as a blue cap. */
export function HpBar({ hp, className }: { hp: HpState; className?: string }) {
  const pct = hp.max > 0 ? Math.max(0, Math.min(1, hp.current / hp.max)) : 0;
  const color = pct > 0.5 ? "bg-moss-400" : pct > 0.25 ? "bg-gold-500" : "bg-blood-500";
  return (
    <div className={cx("relative h-1.5 w-full overflow-hidden rounded bg-ink-700", className)} role="meter" aria-valuenow={hp.current} aria-valuemin={0} aria-valuemax={hp.max}>
      <div className={cx("h-full", color)} style={{ width: `${pct * 100}%` }} />
      {hp.temp > 0 && <div className="absolute right-0 top-0 h-full w-1.5 bg-sky-400" />}
    </div>
  );
}

export function hpColor(hp: HpState): string {
  const pct = hp.max > 0 ? hp.current / hp.max : 0;
  return pct > 0.5 ? "#5f9e5a" : pct > 0.25 ? "#d4a23c" : "#c0392b";
}

interface Props {
  token: TokenDto;
  table: Table;
  combat: Combat;
  ruleset: RulesetDefinition | undefined;
  isGM: boolean;
  /** Owner of the token (players' quick actions on their own creature). */
  canControl: boolean;
}

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

/**
 * HP (damage/heal/temp, DM set), conditions with durations, and DM-only settings
 * (HP visibility, AC, defenses) for the selected token. HP of a linked character
 * lives on the character sheet; everything else is stored on the token.
 */
export function VitalsPanel({ token, table, combat, ruleset, isGM, canControl }: Props) {
  const t = useT();
  const v = token.vitals;
  const [amount, setAmount] = useState("");
  const [damageType, setDamageType] = useState("");
  const [condId, setCondId] = useState("");
  const [condRounds, setCondRounds] = useState("");
  const [maxDraft, setMaxDraft] = useState("");
  const editable = isGM || canControl;

  useEffect(() => {
    setAmount("");
    setMaxDraft("");
  }, [token.id]);

  if (!v) {
    return (
      <div className="space-y-2 rounded-md border border-ink-700 p-2 text-sm" data-testid="vitals">
        <p className="text-xs text-parchment-500">{token.vitalsHidden ? t("vitals.hidden") : t("vitals.untracked")}</p>
        {isGM && !token.vitalsHidden && <SetMax token={token} combat={combat} value={maxDraft} setValue={setMaxDraft} />}
      </div>
    );
  }

  const n = Math.max(0, Math.min(100000, Math.floor(Number(amount) || 0)));
  const hp = v.hp;
  const send = async (action: HpAction) => {
    const res = await combat.applyHp(token.id, action);
    if (res) setAmount("");
  };
  const tokenStats = (): TokenStats => ({
    hp: v.hp ?? { current: 0, max: 0, temp: 0 },
    ac: v.ac,
    initiativeBonus: v.initiativeBonus ?? 0,
    conditions: v.conditions,
    defenses: v.defenses,
  });
  const patchStats = (p: Partial<TokenStats>) => void table.updateToken(token.id, { stats: { ...tokenStats(), ...p } });
  const setConditions = (list: TokenCondition[]) => void combat.setConditions(token.id, list);
  const condName = (id: string) => ruleset?.conditions.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-2 rounded-md border border-ink-700 p-2 text-sm" data-testid="vitals">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-parchment-400">HP</span>
        {hp ? (
          <span className="font-mono text-parchment-50" data-testid="hp-value">
            {hp.current} / {hp.max}
            {hp.temp > 0 && <span className="text-sky-300"> +{hp.temp}</span>}
          </span>
        ) : (
          <span className="text-xs text-parchment-500">—</span>
        )}
        <span className="text-xs text-parchment-400">AC {v.ac ?? "—"}</span>
      </div>
      {hp && hp.max > 0 && <HpBar hp={hp} />}
      {hp && hp.current <= 0 && <p className="text-xs text-blood-400">{t("vitals.down")}</p>}

      {editable && hp && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <Input
              type="number"
              min={0}
              max={100000}
              inputMode="numeric"
              className="h-8 w-20"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t("vitals.amount")}
              data-testid="hp-amount"
            />
            <Select className="h-8 flex-1 text-xs" value={damageType} onChange={(e) => setDamageType(e.target.value)} aria-label={t("vitals.damageType")}>
              <option value="">{t("vitals.untyped")}</option>
              {(ruleset?.damageTypes ?? []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="danger" disabled={!n} onClick={() => void send({ kind: "damage", amount: n, damageType: damageType || null })} data-testid="hp-damage">
              {t("vitals.damage")}
            </Button>
            <Button size="sm" disabled={!n} onClick={() => void send({ kind: "heal", amount: n })} data-testid="hp-heal">
              {t("vitals.heal")}
            </Button>
            <Button size="sm" variant="ghost" disabled={!n} onClick={() => void send({ kind: "temp", amount: n })}>
              {t("vitals.temp")}
            </Button>
            {isGM && (
              <Button size="sm" variant="ghost" onClick={() => void send({ kind: "set", current: Math.min(n, hp.max) })} title={t("vitals.setHint")}>
                {t("vitals.set")}
              </Button>
            )}
          </div>
        </div>
      )}
      {isGM && v.source === "token" && <SetMax token={token} combat={combat} value={maxDraft} setValue={setMaxDraft} />}

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-parchment-400">{t("vitals.conditions")}</p>
        {v.conditions.length === 0 && <p className="text-xs text-parchment-500">{t("vitals.noConditions")}</p>}
        <ul className="flex flex-wrap gap-1" data-testid="conditions">
          {v.conditions.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded bg-ink-700 px-1.5 py-0.5 text-xs" title={ruleset?.conditions.find((x) => x.id === c.id)?.summary}>
              {condName(c.id)}
              {c.level ? ` ${c.level}` : ""}
              {c.durationRounds !== null && <span className="text-parchment-400">({t("vitals.roundsLeft", { n: c.durationRounds })})</span>}
              {editable && (
                <button type="button" className="text-parchment-400 hover:text-blood-400" aria-label={t("common.delete")} onClick={() => setConditions(v.conditions.filter((x) => x.id !== c.id))}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <form
            className="mt-1.5 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!condId) return;
              const def = ruleset?.conditions.find((c) => c.id === condId);
              const rounds = condRounds.trim() ? Math.max(1, Math.min(100000, Math.floor(Number(condRounds)))) : null;
              const existing = v.conditions.find((c) => c.id === condId);
              const level = def?.maxLevel ? Math.min(def.maxLevel, (existing?.level ?? 0) + 1) : undefined;
              const next = [...v.conditions.filter((c) => c.id !== condId), { id: condId, durationRounds: rounds, ...(level ? { level } : {}) }];
              setConditions(next);
              setCondId("");
              setCondRounds("");
            }}
          >
            <Select className="h-8 flex-1 text-xs" value={condId} onChange={(e) => setCondId(e.target.value)} aria-label={t("vitals.addCondition")} data-testid="condition-select">
              <option value="">{t("vitals.addCondition")}…</option>
              {(ruleset?.conditions ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input className="h-8 w-16" type="number" min={1} placeholder={t("vitals.rounds")} value={condRounds} onChange={(e) => setCondRounds(e.target.value)} aria-label={t("vitals.rounds")} />
            <Button size="sm" type="submit" disabled={!condId} data-testid="condition-add">
              +
            </Button>
          </form>
        )}
      </div>

      {isGM && (
        <div className="space-y-2 border-t border-ink-700 pt-2">
          <Field label={t("vitals.visibility")}>
            <Select value={token.hpVisibility} onChange={(e) => void table.updateToken(token.id, { hpVisibility: e.target.value as HpVisibility })} data-testid="hp-visibility">
              {HP_VISIBILITY.map((h) => (
                <option key={h} value={h}>
                  {t(`vitals.visibility.${h}`)}
                </option>
              ))}
            </Select>
          </Field>
          {v.source === "token" ? (
            <TokenStatFields key={token.id} stats={tokenStats()} onSave={patchStats} />
          ) : (
            <p className="text-xs text-parchment-500">{t("vitals.fromSheet")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function SetMax({ token, combat, value, setValue }: { token: TokenDto; combat: Combat; value: string; setValue(v: string): void }) {
  const t = useT();
  const max = Math.max(0, Math.min(10000, Math.floor(Number(value) || 0)));
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!max) return;
        void combat.applyHp(token.id, { kind: "set", current: max, max }).then((r) => r && setValue(""));
      }}
    >
      <Input className="h-8 w-20" type="number" min={1} max={10000} placeholder={t("vitals.maxHp")} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("vitals.maxHp")} data-testid="max-hp" />
      <Button size="sm" type="submit" disabled={!max} data-testid="max-hp-set">
        {token.vitals?.hp?.max ? t("vitals.resetMax") : t("vitals.trackHp")}
      </Button>
    </form>
  );
}

function TokenStatFields({ stats, onSave }: { stats: TokenStats; onSave(p: Partial<TokenStats>): void }) {
  const t = useT();
  const fromStats = (st: TokenStats) => ({
    ac: st.ac === null ? "" : String(st.ac),
    init: String(st.initiativeBonus),
    res: st.defenses.resistances.join(", "),
    vul: st.defenses.vulnerabilities.join(", "),
    imm: st.defenses.immunities.join(", "),
  });
  const [draft, setDraft] = useState(() => fromStats(stats));
  const editing = useRef(false);
  const serverKey = JSON.stringify([stats.ac, stats.initiativeBonus, stats.defenses]);
  // Take outside changes (other DM, server clamping) unless the user is mid-edit.
  useEffect(() => {
    if (!editing.current) setDraft(fromStats(stats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const { ac, init, res, vul, imm } = draft;
  const setAc = set("ac"), setInit = set("init"), setRes = set("res"), setVul = set("vul"), setImm = set("imm");
  const save = () => {
    const acN = ac.trim() === "" ? null : Math.max(0, Math.min(50, Math.floor(Number(ac) || 0)));
    const initN = Math.max(-20, Math.min(50, Math.floor(Number(init) || 0)));
    const defenses = { resistances: splitList(res), vulnerabilities: splitList(vul), immunities: splitList(imm) };
    if (acN === stats.ac && initN === stats.initiativeBonus && JSON.stringify(defenses) === JSON.stringify(stats.defenses)) return;
    onSave({ ac: acN, initiativeBonus: initN, defenses });
  };
  return (
    <div
      className="space-y-1.5"
      onFocus={() => (editing.current = true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) editing.current = false;
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="AC">
          <Input type="number" min={0} max={50} value={ac} onChange={setAc} onBlur={save} data-testid="token-ac" />
        </Field>
        <Field label={t("vitals.initBonus")}>
          <Input type="number" min={-20} max={50} value={init} onChange={setInit} onBlur={save} />
        </Field>
      </div>
      <Field label={t("vitals.resistances")}>
        <Input value={res} placeholder="fire, cold" onChange={setRes} onBlur={save} data-testid="token-resistances" />
      </Field>
      <Field label={t("vitals.vulnerabilities")}>
        <Input value={vul} onChange={setVul} onBlur={save} />
      </Field>
      <Field label={t("vitals.immunities")}>
        <Input value={imm} onChange={setImm} onBlur={save} />
      </Field>
    </div>
  );
}
