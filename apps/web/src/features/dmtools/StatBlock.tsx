import { ABILITIES, abilityModifier, formatModifier, type SrdMonster } from "@vtt/rules";
import type { RollRequest } from "../lobby/useLobby";
import { toast } from "../../stores/toast";
import { errorMessage } from "../../lib/api";

const SKILL_NAMES: Record<string, string> = { animal_handling: "Animal Handling", sleight_of_hand: "Sleight of Hand" };
const skillName = (id: string) => SKILL_NAMES[id] ?? id[0]!.toUpperCase() + id.slice(1);

/**
 * An SRD stat block. With `onRoll`, attack and damage lines become buttons that roll on
 * the server (DM-only by default, so players don't see monster numbers).
 */
export function StatBlock({ monster: m, onRoll, label }: { monster: SrdMonster; onRoll?: (req: RollRequest) => Promise<unknown>; label?: string }) {
  const who = label ?? m.name;
  const roll = (formula: string, what: string, rollType: string) =>
    onRoll?.({ formula, label: `${who} — ${what}`, rollType, visibility: "dm_only" }).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="space-y-2 text-sm text-parchment-200" data-testid="stat-block">
      <div>
        <h3 className="font-display text-lg text-gold-300">{m.name}</h3>
        <p className="text-xs italic text-parchment-400">
          {m.size} {m.type}, {m.alignment}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 border-y border-gold-700/40 py-1.5 text-xs">
        <dt className="font-semibold text-gold-400">AC</dt>
        <dd>
          {m.ac}
          {m.acNote ? ` (${m.acNote})` : ""}
        </dd>
        <dt className="font-semibold text-gold-400">HP</dt>
        <dd>
          {m.hp} ({m.hitDice})
        </dd>
        <dt className="font-semibold text-gold-400">Speed</dt>
        <dd>{m.speed}</dd>
      </dl>
      <div className="grid grid-cols-6 gap-1 text-center text-xs">
        {ABILITIES.map((a) => (
          <button
            key={a}
            type="button"
            disabled={!onRoll}
            onClick={() => roll(`1d20${formatModifier(abilityModifier(m.abilities[a]))}`, `${a.toUpperCase()} check`, "check")}
            className="rounded border border-ink-700 py-1 enabled:hover:border-gold-500"
            title={onRoll ? `Roll ${a.toUpperCase()} check` : undefined}
          >
            <div className="font-semibold text-gold-400">{a.toUpperCase()}</div>
            <div>
              {m.abilities[a]} ({formatModifier(abilityModifier(m.abilities[a]))})
            </div>
          </button>
        ))}
      </div>
      <dl className="space-y-0.5 text-xs">
        {m.saves && <Line k="Saving Throws" v={Object.entries(m.saves).map(([a, b]) => `${a.toUpperCase()} ${formatModifier(b)}`).join(", ")} />}
        {m.skills && <Line k="Skills" v={Object.entries(m.skills).map(([s, b]) => `${skillName(s)} ${formatModifier(b)}`).join(", ")} />}
        {m.vulnerabilities?.length ? <Line k="Damage Vulnerabilities" v={m.vulnerabilities.join(", ")} /> : null}
        {m.resistances?.length ? <Line k="Damage Resistances" v={m.resistances.join(", ")} /> : null}
        {m.immunities?.length ? <Line k="Damage Immunities" v={m.immunities.join(", ")} /> : null}
        {m.conditionImmunities?.length ? <Line k="Condition Immunities" v={m.conditionImmunities.join(", ")} /> : null}
        <Line k="Senses" v={m.senses} />
        <Line k="Languages" v={m.languages} />
        <Line k="Challenge" v={`${m.cr} (${m.xp.toLocaleString()} XP)`} />
      </dl>
      {m.traits.map((t) => (
        <p key={t.name} className="text-xs">
          <b className="italic text-parchment-50">{t.name}.</b> {t.description}
        </p>
      ))}
      {m.actions.length > 0 && <h4 className="border-b border-gold-700/40 text-xs font-semibold uppercase tracking-wider text-gold-400">Actions</h4>}
      {m.actions.map((x) => (
        <div key={x.name} className="text-xs">
          <b className="italic text-parchment-50">{x.name}.</b> {x.description}
          {(x.attackBonus !== undefined || x.damage) && (
            <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
              {x.attackBonus !== undefined && (
                <RollChip disabled={!onRoll} onClick={() => roll(`1d20${formatModifier(x.attackBonus!)}`, `${x.name} attack`, "attack")} testid={`sb-attack-${x.name}`}>
                  {formatModifier(x.attackBonus)} to hit
                </RollChip>
              )}
              {x.damage && (
                <RollChip disabled={!onRoll} onClick={() => roll(x.extraDamage ? `${x.damage}+${x.extraDamage.formula}` : x.damage!, `${x.name} damage`, "damage")} testid={`sb-damage-${x.name}`}>
                  {x.damage} {x.damageType}
                  {x.extraDamage ? ` + ${x.extraDamage.formula} ${x.extraDamage.type}` : ""}
                </RollChip>
              )}
            </span>
          )}
        </div>
      ))}
      {m.reactions?.length ? <h4 className="border-b border-gold-700/40 text-xs font-semibold uppercase tracking-wider text-gold-400">Reactions</h4> : null}
      {m.reactions?.map((t) => (
        <p key={t.name} className="text-xs">
          <b className="italic text-parchment-50">{t.name}.</b> {t.description}
        </p>
      ))}
      <p className="pt-1 text-[10px] text-parchment-500">SRD 5.1 · CC-BY-4.0</p>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="inline font-semibold text-gold-400">{k}</dt> <dd className="inline">{v}</dd>
    </div>
  );
}

function RollChip({ children, onClick, disabled, testid }: { children: React.ReactNode; onClick(): void; disabled?: boolean; testid?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="rounded border border-gold-700/60 bg-gold-500/10 px-1.5 py-0.5 text-[11px] text-gold-200 enabled:hover:bg-gold-500/25 disabled:opacity-70"
    >
      🎲 {children}
    </button>
  );
}
