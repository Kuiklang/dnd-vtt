import { useState, type FormEvent } from "react";
import { ROLL_VISIBILITY_LABELS, validateFormula, type RollMode, type RollVisibility } from "@vtt/rules";
import { Button, Input, Select, cx } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { RollRequest } from "./useLobby";

const DICE = [4, 6, 8, 10, 12, 20, 100];

export function DiceTray({
  onRoll,
  canRollHidden,
  members,
  myId,
}: {
  onRoll: (req: RollRequest) => Promise<unknown>;
  canRollHidden: boolean;
  members: Array<{ userId: string; name: string }>;
  myId: string;
}) {
  const [formula, setFormula] = useState("1d20");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<RollMode>("normal");
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const formulaError = formula.trim() ? validateFormula(formula) : null;

  const roll = async (f: string, l = label) => {
    if (visibility === "whisper" && recipients.length === 0) return toast.error("Pick who to whisper the roll to");
    setBusy(true);
    try {
      await onRoll({ formula: f, label: l, mode, visibility, recipientIds: visibility === "whisper" ? recipients : [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Roll failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (formulaError) return;
    void roll(formula.trim());
  };

  const visibilities = (Object.keys(ROLL_VISIBILITY_LABELS) as RollVisibility[]).filter((v) => v !== "dm_only" || canRollHidden);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1">
        {DICE.map((d) => (
          <button
            key={d}
            disabled={busy}
            onClick={() => roll(`1d${d}`, "")}
            className="rounded-md border border-ink-600 bg-ink-800 py-2 font-display text-sm text-parchment-50 hover:border-gold-500 hover:text-gold-300 disabled:opacity-50"
            title={`Roll 1d${d}`}
          >
            d{d}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <Input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="2d20kh1+5, 4d6dl1, 8d6[fire]…" className="font-mono" aria-label="Dice formula" aria-invalid={!!formulaError} />
          <Button type="submit" variant="primary" loading={busy} disabled={!!formulaError || !formula.trim()}>
            Roll
          </Button>
        </div>
        {formulaError && <p className="text-xs text-blood-400">{formulaError}</p>}
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional), e.g. Stealth" maxLength={80} aria-label="Roll label" />
        <div className="grid grid-cols-3 gap-1 rounded-md bg-ink-900 p-1 text-xs" role="radiogroup" aria-label="Roll mode">
          {(["disadvantage", "normal", "advantage"] as const).map((m) => (
            <button
              type="button"
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cx("rounded py-1.5 capitalize", mode === m ? (m === "advantage" ? "bg-moss-600/40 text-moss-400" : m === "disadvantage" ? "bg-blood-700/40 text-blood-400" : "bg-ink-700 text-parchment-50") : "text-parchment-400")}
            >
              {m}
            </button>
          ))}
        </div>
        <Select value={visibility} onChange={(e) => setVisibility(e.target.value as RollVisibility)} aria-label="Roll visibility">
          {visibilities.map((v) => (
            <option key={v} value={v}>
              {ROLL_VISIBILITY_LABELS[v]}
            </option>
          ))}
        </Select>
        {visibility === "whisper" && (
          <div className="flex flex-wrap gap-1">
            {members
              .filter((m) => m.userId !== myId)
              .map((m) => (
                <label key={m.userId} className={cx("cursor-pointer rounded border px-2 py-1 text-xs", recipients.includes(m.userId) ? "border-gold-500 text-gold-300" : "border-ink-600 text-parchment-400")}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={recipients.includes(m.userId)}
                    onChange={(e) => setRecipients(e.target.checked ? [...recipients, m.userId] : recipients.filter((r) => r !== m.userId))}
                  />
                  {m.name}
                </label>
              ))}
          </div>
        )}
      </form>
      <p className="text-[11px] leading-relaxed text-parchment-500">
        Supports +, −, ×, ÷, ( ), kh/kl (keep), dh/dl (drop), r/ro (reroll), ! (explode) and [labels]. Rolls are made on the server.
      </p>
    </div>
  );
}
