import { useEffect, useMemo, useState } from "react";
import { ABILITIES, deriveCharacter, formatModifier, getBuiltinRuleset, type RollMode } from "@vtt/rules";
import { Button, Modal, Select, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { CharacterFull } from "../../lib/types";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import { CharacterSheetLoader } from "../character/CharacterSheetLoader";
import type { RollRequest } from "../lobby/useLobby";

interface Props {
  characterId: string;
  /** Bumps when any character in the campaign changes, so derived bonuses stay current. */
  tick: number;
  /** The viewer's own active character: rolls are attributed to it in the log. */
  myCharacterId: string | null;
  onRoll(req: RollRequest): Promise<unknown>;
  /** Monster/NPC stat blocks roll DM-only so players don't see their numbers. */
  visibility?: RollRequest["visibility"];
  /** Label prefix (defaults to the sheet's name; tokens like "Goblin 2" pass their own). */
  label?: string;
}

const d20 = (bonus: number) => (bonus === 0 ? "1d20" : `1d20${bonus > 0 ? "+" : ""}${bonus}`);

/**
 * Quick rolls from a token linked to a character sheet: ability checks, saving throws,
 * skills, initiative and attacks, using the same derived numbers as the sheet. Rolls are
 * made on the server and posted to the dice log like any other roll.
 */
export function TokenRolls({ characterId, tick, myCharacterId, onRoll, visibility, label: who }: Props) {
  const t = useT();
  const [character, setCharacter] = useState<CharacterFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RollMode>("normal");
  const [kind, setKind] = useState<"check" | "save">("check");
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ character: CharacterFull }>(`/api/characters/${characterId}`)
      .then((r) => !cancelled && (setCharacter(r.character), setError(null)))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [characterId, tick]);

  const ruleset = character ? getBuiltinRuleset(character.rulesetId) : undefined;
  const derived = useMemo(() => (character && ruleset ? deriveCharacter(character.data, ruleset) : null), [character, ruleset]);

  if (error) return <p className="text-xs text-blood-400">{error}</p>;
  if (!character || !derived || !ruleset) return null;
  // A summary-only character (someone else's private sheet) has nothing to roll from.
  if ((character.access as string) === "summary") return null;

  const roll = (formula: string, label: string, rollType: string, useMode = true, extra: RollMode = "normal") => {
    const m = useMode ? (extra !== "normal" && mode === "normal" ? extra : mode) : "normal";
    onRoll({ formula, label: `${who ?? character.name} — ${label}`, rollType, mode: m, visibility, characterId: characterId === myCharacterId ? characterId : null }).catch((e) =>
      toast.error(errorMessage(e)),
    );
  };
  const penalty = derived.d20Penalty;

  return (
    <div className="space-y-2 rounded-md border border-ink-700 p-2 text-sm" data-testid="token-rolls">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-parchment-400">{t("rolls.title")}</span>
        <div className="flex rounded border border-ink-600 text-xs" role="group" aria-label={t("rolls.mode")}>
          {(["disadvantage", "normal", "advantage"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={cx("px-1.5 py-0.5", mode === m ? "bg-gold-500/25 text-gold-200" : "text-parchment-400 hover:text-parchment-100")}
              onClick={() => setMode(m)}
            >
              {t(`rolls.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1 text-xs">
        {(["check", "save"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            className={cx("rounded px-2 py-0.5", kind === k ? "bg-ink-700 text-parchment-50" : "text-parchment-400 hover:text-parchment-100")}
            onClick={() => setKind(k)}
          >
            {t(k === "check" ? "rolls.checks" : "rolls.saves")}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {ABILITIES.map((a) => {
          const def = ruleset.abilities.find((x) => x.id === a);
          const value = kind === "check" ? derived.abilityModifiers[a] - penalty : derived.savingThrows[a].value;
          return (
            <button
              key={a}
              type="button"
              data-testid={`roll-${kind}-${a}`}
              className={cx(
                "rounded border px-1 py-1 text-center hover:border-gold-500",
                kind === "save" && derived.savingThrows[a].proficient ? "border-gold-600/60" : "border-ink-600",
              )}
              title={`${def?.name ?? a} ${kind === "check" ? "check" : "saving throw"}`}
              onClick={() => roll(d20(value), `${def?.name ?? a} ${kind === "check" ? "check" : "save"}`, kind)}
            >
              <span className="block text-[10px] text-parchment-400">{def?.short ?? a.toUpperCase()}</span>
              <span className="font-mono text-parchment-50">{formatModifier(value)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <Select
          className="h-8 flex-1 text-xs"
          value=""
          aria-label={t("rolls.skill")}
          data-testid="roll-skill"
          onChange={(e) => {
            const s = derived.skills.find((x) => x.id === e.target.value);
            if (s) roll(d20(s.value), s.name, "skill", true, s.rollMode);
          }}
        >
          <option value="">{t("rolls.skill")}…</option>
          {derived.skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {formatModifier(s.value)}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => roll(d20(derived.initiative.value), "Initiative", "initiative")}>
          Init {formatModifier(derived.initiative.value)}
        </Button>
      </div>
      {derived.attacks.length > 0 && (
        <ul className="space-y-1">
          {derived.attacks.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate" title={a.name}>
                {a.name}
              </span>
              {a.attackBonus && (
                <Button size="sm" variant="ghost" onClick={() => roll(d20(a.attackBonus!.value), `${a.name} attack`, "attack")} data-testid="roll-attack">
                  {formatModifier(a.attackBonus.value)}
                </Button>
              )}
              {a.damageFormula && (
                <Button size="sm" variant="ghost" onClick={() => roll(a.damageFormula, `${a.name} damage${a.damageType ? ` (${a.damageType})` : ""}`, "damage", false)}>
                  {a.damageFormula}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="ghost" onClick={() => setSheetOpen(true)} data-testid="open-sheet">
        {t("rolls.openSheet")}
      </Button>
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={character.name} wide>
        <CharacterSheetLoader
          key={`${characterId}:${tick}`}
          characterId={characterId}
          onRoll={(req) => onRoll({ ...req, characterId: characterId === myCharacterId ? characterId : null })}
          rollTarget="campaign"
        />
      </Modal>
    </div>
  );
}
