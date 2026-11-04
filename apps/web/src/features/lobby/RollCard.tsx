import type { RollResult } from "@vtt/rules";
import { cx } from "../../components/ui";

const VIS_LABEL: Record<string, string> = {
  public: "",
  private: "private",
  dm_only: "DM only",
  whisper: "whisper",
  blind: "blind",
};

export interface RollView {
  label: string;
  who: string;
  visibility: string;
  redacted: boolean;
  formula?: string;
  total?: number;
  result?: RollResult;
  createdAt: string;
}

/** Shows one roll with every die, dropped dice struck through, and crit/fumble highlights. */
export function RollCard({ roll, highlight }: { roll: RollView; highlight?: boolean }) {
  const crit = roll.result?.critical;
  const fumble = roll.result?.fumble;
  return (
    <div
      className={cx(
        "rounded-lg border bg-ink-900/80 px-3 py-2",
        crit ? "border-gold-500 shadow-[0_0_14px_-4px_rgba(217,177,79,0.8)]" : fumble ? "border-blood-500" : "border-ink-700",
        highlight && "animate-[pulse_0.6s_ease-out_1]",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs text-parchment-500">
        <span className="truncate">
          <span className="text-parchment-200">{roll.who}</span>
          {roll.label && <> · {roll.label}</>}
        </span>
        <span className="shrink-0">
          {VIS_LABEL[roll.visibility] && <span className="mr-1 rounded bg-ink-700 px-1 text-[10px] uppercase">{VIS_LABEL[roll.visibility]}</span>}
          {new Date(roll.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {roll.redacted ? (
        <p className="mt-1 text-sm italic text-parchment-400">🙈 Blind roll — only the DM sees the result.</p>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-parchment-400">
              {roll.formula}
              {roll.result && roll.result.mode !== "normal" && <span className="ml-1 text-arcane-400">({roll.result.mode})</span>}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {roll.result?.terms.map((t, ti) =>
                t.dice.map((d, di) => (
                  <span
                    key={`${ti}-${di}`}
                    title={`d${t.sides}${t.label ? ` ${t.label}` : ""}${d.rerolledFrom ? ` (rerolled ${d.rerolledFrom.join(", ")})` : ""}${d.exploded ? " (exploded)" : ""}`}
                    className={cx(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 font-mono text-xs",
                      d.dropped ? "bg-ink-800 text-parchment-500 line-through" : "bg-ink-700 text-parchment-50",
                      !d.dropped && d.value === t.sides && "text-gold-300",
                      !d.dropped && d.value === 1 && "text-blood-400",
                      d.exploded && "ring-1 ring-gold-600",
                    )}
                  >
                    {d.value}
                  </span>
                )),
              )}
            </div>
          </div>
          <div className="text-right">
            <p className={cx("font-display text-2xl font-bold", crit ? "text-gold-300" : fumble ? "text-blood-400" : "text-parchment-50")}>{roll.total}</p>
            {crit && <p className="text-[10px] font-bold uppercase text-gold-400">Critical!</p>}
            {fumble && <p className="text-[10px] font-bold uppercase text-blood-400">Fumble</p>}
          </div>
        </div>
      )}
    </div>
  );
}
