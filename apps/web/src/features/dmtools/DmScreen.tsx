import type { RulesetDefinition } from "@vtt/rules";
import { Button } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import type { RollRequest } from "../lobby/useLobby";

/* Reference numbers from SRD 5.1 (CC-BY-4.0); descriptions are short paraphrases. */
const DCS: Array<[string, number]> = [
  ["Very easy", 5],
  ["Easy", 10],
  ["Medium", 15],
  ["Hard", 20],
  ["Very hard", 25],
  ["Nearly impossible", 30],
];
const COVER: Array<[string, string]> = [
  ["Half cover", "+2 AC and DEX saves"],
  ["Three-quarters cover", "+5 AC and DEX saves"],
  ["Total cover", "Can't be targeted directly"],
];
const ACTIONS: Array<[string, string]> = [
  ["Attack", "Make one weapon attack (more with Extra Attack)."],
  ["Cast a Spell", "Cast a spell with a casting time of 1 action."],
  ["Dash", "Gain extra movement equal to your speed."],
  ["Disengage", "Your movement doesn't provoke opportunity attacks this turn."],
  ["Dodge", "Attacks against you have disadvantage; advantage on DEX saves."],
  ["Help", "Give an ally advantage on a check or their next attack."],
  ["Hide", "Make a Stealth check to hide."],
  ["Ready", "Prepare an action to take as a reaction to a trigger."],
  ["Search", "Make a Perception or Investigation check."],
  ["Use an Object", "Interact with a second object or use one that needs an action."],
];

/** Quick reference for running the game, plus hidden d20/d100 rolls. */
export function DmScreen({ ruleset, onRoll }: { ruleset: RulesetDefinition | null; onRoll: (req: RollRequest) => Promise<unknown> }) {
  const t = useT();
  const hidden = (formula: string) => onRoll({ formula, label: t("dmscreen.secretRoll"), rollType: "check", visibility: "dm_only" }).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="grid gap-3 text-sm md:grid-cols-3" data-testid="dm-screen">
      <Panel title={t("dmscreen.dcs")}>
        <table className="w-full">
          <tbody>
            {DCS.map(([name, dc]) => (
              <tr key={name} className="border-b border-ink-800">
                <td className="py-0.5">{name}</td>
                <td className="text-right font-semibold text-gold-300">{dc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h5 className="mt-3 text-xs font-semibold uppercase tracking-wider text-gold-400">{t("dmscreen.cover")}</h5>
        <ul className="space-y-0.5 text-xs">
          {COVER.map(([k, v]) => (
            <li key={k}>
              <b className="text-parchment-50">{k}:</b> {v}
            </li>
          ))}
        </ul>
        <h5 className="mt-3 text-xs font-semibold uppercase tracking-wider text-gold-400">{t("dmscreen.secret")}</h5>
        <div className="flex flex-wrap gap-1">
          {["1d20", "1d100", "2d6", "1d4"].map((f) => (
            <Button key={f} size="sm" onClick={() => hidden(f)} data-testid={`dm-secret-${f}`}>
              🔒 {f}
            </Button>
          ))}
        </div>
      </Panel>
      <Panel title={t("dmscreen.conditions")}>
        <ul className="scroll-thin max-h-[50vh] space-y-1 overflow-y-auto pr-1 text-xs">
          {(ruleset?.conditions ?? []).map((c) => (
            <li key={c.id}>
              <b className="text-parchment-50">{c.name}.</b> {c.summary}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={t("dmscreen.actions")}>
        <ul className="space-y-1 text-xs">
          {ACTIONS.map(([k, v]) => (
            <li key={k}>
              <b className="text-parchment-50">{k}.</b> {v}
            </li>
          ))}
        </ul>
        <h5 className="mt-3 text-xs font-semibold uppercase tracking-wider text-gold-400">{t("dmscreen.damageTypes")}</h5>
        <p className="text-xs">{ruleset?.damageTypes.join(", ")}</p>
      </Panel>
      <p className="text-[10px] text-parchment-500 md:col-span-3">{ruleset?.attribution}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-ink-700 bg-ink-900/60 p-2">
      <h4 className="mb-1 border-b border-ink-700 pb-1 text-xs font-semibold uppercase tracking-wider text-gold-400">{title}</h4>
      {children}
    </section>
  );
}
