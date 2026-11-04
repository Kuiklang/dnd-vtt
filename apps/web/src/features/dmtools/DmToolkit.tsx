import type { RulesetDefinition } from "@vtt/rules";
import { Modal, cx } from "../../components/ui";
import type { CampaignDetail } from "../../lib/types";
import { useT, type MessageKey } from "../../i18n";
import type { RollRequest } from "../lobby/useLobby";
import type { TokenInput } from "../table/useTable";
import { BestiaryPanel } from "./BestiaryPanel";
import { DmScreen } from "./DmScreen";
import { EncounterPanel } from "./EncounterPanel";
import { JournalPanel } from "./JournalPanel";
import { TablesPanel } from "./TablesPanel";
import type { Journal } from "./useJournal";

export type ToolkitTab = "journal" | "bestiary" | "encounters" | "tables" | "screen";

interface Props {
  open: boolean;
  onClose(): void;
  tab: ToolkitTab;
  onTab(tab: ToolkitTab): void;
  detail: CampaignDetail;
  journal: Journal;
  ruleset: RulesetDefinition | null;
  onRoll: (req: RollRequest) => Promise<unknown>;
  onPlace?: (tokens: TokenInput[]) => Promise<string[]>;
  onFight?: (tokenIds: string[]) => Promise<unknown>;
}

const TABS: Array<{ id: ToolkitTab; key: MessageKey; cap: string | null }> = [
  { id: "journal", key: "toolkit.journal", cap: null },
  { id: "bestiary", key: "toolkit.bestiary", cap: "npc.manage" },
  { id: "encounters", key: "toolkit.encounters", cap: "npc.manage" },
  { id: "tables", key: "toolkit.tables", cap: "tables.manage" },
  { id: "screen", key: "toolkit.screen", cap: "journal.manage" },
];

/** Journal for everyone; bestiary, encounters, random tables and the DM screen for those with the capability. */
export function DmToolkit({ open, onClose, tab, onTab, detail, journal, ruleset, onRoll, onPlace, onFight }: Props) {
  const t = useT();
  const caps = new Set<string>(detail.me.capabilities);
  const tabs = TABS.filter((x) => !x.cap || caps.has(x.cap));
  const current = tabs.some((x) => x.id === tab) ? tab : "journal";
  const partySize = detail.members.filter((m) => m.role === "player").length;
  return (
    <Modal open={open} onClose={onClose} title={tabs.length > 1 ? t("toolkit.title") : t("toolkit.journal")} wide>
      {tabs.length > 1 && (
        <div className="-mt-1 mb-3 flex flex-wrap gap-1 border-b border-ink-700" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={current === x.id}
              onClick={() => onTab(x.id)}
              data-testid={`toolkit-tab-${x.id}`}
              className={cx("-mb-px border-b-2 px-3 py-1.5 text-sm", current === x.id ? "border-gold-400 text-gold-300" : "border-transparent text-parchment-400 hover:text-parchment-100")}
            >
              {t(x.key)}
            </button>
          ))}
        </div>
      )}
      {current === "journal" && <JournalPanel detail={detail} journal={journal} manager={caps.has("journal.manage")} canShow={caps.has("handout.send")} />}
      {current === "bestiary" && <BestiaryPanel campaignId={detail.campaign.id} rulesetId={detail.campaign.rulesetId} onPlace={onPlace} onRoll={onRoll} />}
      {current === "encounters" && <EncounterPanel campaignId={detail.campaign.id} partySize={partySize} onPlace={onPlace} onFight={onFight} />}
      {current === "tables" && <TablesPanel campaignId={detail.campaign.id} />}
      {current === "screen" && <DmScreen ruleset={ruleset} onRoll={onRoll} />}
    </Modal>
  );
}
