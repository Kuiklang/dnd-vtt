import { useState } from "react";
import type { ActionEconomy } from "@vtt/rules";
import { Button, Input, cx } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";
import type { Combat } from "./useCombat";
import type { CombatantDto, TokenDto } from "./types";
import { HpBar } from "./VitalsPanel";

interface Props {
  combat: Combat;
  sceneId: string | null;
  tokens: TokenDto[];
  myId: string;
  isGM: boolean;
  selectedId: string | null;
  onSelectToken(id: string): void;
}

const ACTION_KEYS: Array<[keyof Omit<ActionEconomy, "movementUsed">, MessageKey]> = [
  ["action", "combat.action"],
  ["bonusAction", "combat.bonusAction"],
  ["reaction", "combat.reaction"],
  ["freeInteraction", "combat.freeInteraction"],
];

/** Initiative tracker: start/end (DM), rolling, turn order, round counter and the active creature's action economy. */
export function CombatPanel({ combat: cb, sceneId, tokens, myId, isGM, selectedId, onSelectToken }: Props) {
  const t = useT();
  const c = cb.combat;
  const [customName, setCustomName] = useState("");

  if (!c) {
    return (
      <div className="space-y-2 text-sm" data-testid="combat-panel">
        <p className="text-parchment-400">{t("combat.none")}</p>
        {isGM && sceneId && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={cb.busy} onClick={() => void cb.start(sceneId)} data-testid="combat-start">
                {t("combat.start")}
              </Button>
              {selectedId && (
                <Button size="sm" disabled={cb.busy} onClick={() => void cb.start(sceneId, [selectedId])}>
                  {t("combat.startSelected")}
                </Button>
              )}
            </div>
            <p className="text-xs text-parchment-500">{t("combat.startHint")}</p>
          </>
        )}
      </div>
    );
  }

  const active = c.combatants.find((x) => x.id === c.activeCombatantId) ?? null;
  const myTurn = !!active && active.ownerIds.includes(myId);
  const canEditActions = (x: CombatantDto) => isGM || x.ownerIds.includes(myId);
  const notInCombat = isGM && selectedId && !c.combatants.some((x) => x.tokenId === selectedId) ? tokens.find((tk) => tk.id === selectedId) : null;

  return (
    <div className="space-y-2 text-sm" data-testid="combat-panel">
      <div className="flex items-center gap-2">
        <span className="font-display text-gold-300" data-testid="combat-round">
          {t("combat.round", { n: c.round })}
        </span>
        {!c.activeCombatantId && <span className="text-xs text-parchment-500">{t("combat.notStarted")}</span>}
        {myTurn && (
          <span className="rounded bg-gold-500/20 px-1.5 py-0.5 text-xs text-gold-300" data-testid="your-turn">
            {t("combat.yourTurn")}
          </span>
        )}
      </div>

      {isGM && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={cb.busy} onClick={() => void cb.roll("npcs")} data-testid="roll-npcs">
            {t("combat.rollNpcs")}
          </Button>
          <Button size="sm" disabled={cb.busy} onClick={() => void cb.roll("all")}>
            {t("combat.rollAll")}
          </Button>
        </div>
      )}

      <ol className="space-y-1" data-testid="initiative-list">
        {c.combatants.map((x) => {
          const isActive = x.id === c.activeCombatantId;
          const mine = x.ownerIds.includes(myId);
          return (
            <li
              key={x.id}
              data-testid="combatant"
              data-active={isActive || undefined}
              className={cx(
                "rounded border px-2 py-1.5",
                isActive ? "border-gold-500 bg-gold-500/10" : "border-ink-700",
                x.defeated && "opacity-50",
                x.tokenId && x.tokenId === selectedId && "ring-1 ring-sky-400",
              )}
            >
              <div className="flex items-center gap-2">
                {isGM ? (
                  <InitiativeInput value={x.initiative} onCommit={(v) => void cb.setInitiative(x.id, v)} />
                ) : (
                  <span className="w-9 shrink-0 text-center font-mono text-parchment-100" data-testid="initiative">
                    {x.initiative ?? "—"}
                  </span>
                )}
                <button
                  type="button"
                  className={cx("min-w-0 flex-1 truncate text-left", x.defeated && "line-through", isActive && "font-semibold text-gold-200")}
                  onClick={() => x.tokenId && onSelectToken(x.tokenId)}
                  title={x.name}
                >
                  {x.hidden && <span title={t("combat.hiddenFromPlayers")}>👁‍🗨 </span>}
                  {x.name}
                </button>
                {x.vitals?.hp && <span className="font-mono text-xs text-parchment-300">{x.vitals.hp.current}/{x.vitals.hp.max}</span>}
                {x.initiative === null && (isGM || mine) && (
                  <Button size="sm" variant="ghost" disabled={cb.busy} onClick={() => void cb.roll([x.id])} data-testid="roll-mine">
                    🎲
                  </Button>
                )}
                {isGM && (
                  <button
                    type="button"
                    className="text-xs text-parchment-500 hover:text-blood-400"
                    title={t("combat.remove")}
                    aria-label={t("combat.remove")}
                    onClick={() => window.confirm(t("combat.removeConfirm", { name: x.name })) && void cb.remove(x.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {x.vitals?.hp && x.vitals.hp.max > 0 && <HpBar hp={x.vitals.hp} className="mt-1" />}
              {x.vitals && x.vitals.conditions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {x.vitals.conditions.map((cond) => (
                    <span key={cond.id} className="rounded bg-ink-700 px-1 text-[10px] uppercase text-parchment-200">
                      {cond.id}
                      {cond.level ? ` ${cond.level}` : ""}
                      {cond.durationRounds !== null ? ` · ${cond.durationRounds}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {isGM && (
                <div className="mt-1 flex gap-3 text-xs text-parchment-400">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={x.defeated} onChange={(e) => void cb.update(x.id, { defeated: e.target.checked })} />
                    {t("combat.defeated")}
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={x.hidden} onChange={(e) => void cb.update(x.id, { hidden: e.target.checked })} />
                    {t("combat.hidden")}
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {active && canEditActions(active) && (
        <div className="rounded border border-ink-700 p-2" data-testid="action-economy">
          <p className="mb-1 text-xs text-parchment-400">{t("combat.actionsOf", { name: active.name })}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {ACTION_KEYS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={active.actions[k]} onChange={(e) => void cb.update(active.id, { actions: { [k]: e.target.checked } })} />
                {t(label)}
              </label>
            ))}
          </div>
          <label className="mt-1 flex items-center gap-2 text-xs">
            {t("combat.movementUsed")}
            <Input
              type="number"
              min={0}
              max={10000}
              step={5}
              className="h-7 w-20"
              value={active.actions.movementUsed}
              onChange={(e) => void cb.update(active.id, { actions: { movementUsed: Math.max(0, Number(e.target.value) || 0) } })}
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {isGM && (
          <Button size="sm" variant="ghost" disabled={cb.busy || !c.activeCombatantId} onClick={() => void cb.prev()}>
            ◀ {t("combat.prev")}
          </Button>
        )}
        {(isGM || myTurn) && (
          <Button size="sm" variant="primary" disabled={cb.busy || c.combatants.length === 0} onClick={() => void cb.next()} data-testid="combat-next">
            {c.activeCombatantId ? (myTurn && !isGM ? t("combat.endMyTurn") : t("combat.next")) : t("combat.begin")} ▶
          </Button>
        )}
      </div>

      {isGM && (
        <div className="space-y-1.5 border-t border-ink-700 pt-2">
          {notInCombat && (
            <Button size="sm" onClick={() => void cb.addTokens([notInCombat.id])}>
              {t("combat.addSelected", { name: notInCombat.name })}
            </Button>
          )}
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!customName.trim()) return;
              void cb.addCustom(customName.trim(), 0, false).then((r) => r && setCustomName(""));
            }}
          >
            <Input className="h-8 flex-1" maxLength={60} placeholder={t("combat.customPlaceholder")} value={customName} onChange={(e) => setCustomName(e.target.value)} />
            <Button size="sm" type="submit" disabled={!customName.trim()}>
              {t("combat.add")}
            </Button>
          </form>
          <Button size="sm" variant="danger" disabled={cb.busy} onClick={() => window.confirm(t("combat.endConfirm")) && void cb.end()} data-testid="combat-end">
            {t("combat.end")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Edits a number on blur/Enter, so typing "1" then "7" sends one change. */
function InitiativeInput({ value, onCommit }: { value: number | null; onCommit(v: number | null): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = draft.trim() === "" ? null : Math.round(Number(draft));
    setDraft(null);
    if (v !== value && (v === null || Number.isFinite(v))) onCommit(v);
  };
  return (
    <input
      aria-label="Initiative"
      data-testid="initiative-input"
      inputMode="numeric"
      className="h-7 w-11 shrink-0 rounded border border-ink-600 bg-ink-900 text-center font-mono text-parchment-50"
      value={draft ?? (value === null ? "" : String(value))}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value.replace(/[^\d-]/g, "").slice(0, 4))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
