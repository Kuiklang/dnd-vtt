import { useMemo, useState } from "react";
import { DND5E_2014, getSrdMonster, monsterToCharacterData, searchMonsters, type SrdMonster } from "@vtt/rules";
import { Button, Input, Select, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { CharacterFull } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import type { RollRequest } from "../lobby/useLobby";
import type { TokenInput } from "../table/useTable";
import { StatBlock } from "./StatBlock";
import { characterPlacements, srdPlacements, type PlaceOptions } from "./placement";

interface Props {
  campaignId: string;
  rulesetId: string;
  /** Places tokens on the current map; undefined when no map is open. */
  onPlace?: (tokens: TokenInput[]) => Promise<string[]>;
  onRoll: (req: RollRequest) => Promise<unknown>;
}

/** SRD monsters plus the campaign's own monsters/NPCs: browse, roll, place on the map, copy to edit. */
export function BestiaryPanel({ campaignId, rulesetId, onPlace, onRoll }: Props) {
  const t = useT();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ type: "srd" | "character"; id: string } | null>({ type: "srd", id: "goblin" });
  const [opts, setOpts] = useState<PlaceOptions>({ count: 1, hp: "average", hidden: false });
  const [busy, setBusy] = useState(false);
  const own = useAsync(
    () => api.get<{ characters: CharacterFull[] }>(`/api/campaigns/${campaignId}/characters`).then((r) => r.characters.filter((c) => c.kind !== "pc")),
    [campaignId],
  );
  const srd = useMemo(() => searchMonsters(q), [q]);
  const ownMatches = (own.data ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const monster = picked?.type === "srd" ? getSrdMonster(picked.id) : undefined;
  const character = picked?.type === "character" ? own.data?.find((c) => c.id === picked.id) : undefined;
  // SRD stat blocks are 5e 2014 numbers; they still work in a 2024 campaign but say so.
  const rulesetNote = rulesetId !== DND5E_2014.id;

  const place = async () => {
    if (!onPlace) return;
    const list = monster ? srdPlacements(monster, opts) : character ? characterPlacements(character, opts) : [];
    if (!list.length) return;
    setBusy(true);
    try {
      await onPlace(list);
      toast.success(t("bestiary.placed", { n: list.length }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copyToCampaign = async (m: SrdMonster) => {
    setBusy(true);
    try {
      const { character: c } = await api.post<{ character: CharacterFull }>("/api/characters", {
        name: m.name,
        kind: "monster",
        rulesetId,
        campaignId,
        data: monsterToCharacterData(m),
      });
      await own.reload();
      setPicked({ type: "character", id: c.id });
      toast.success(t("bestiary.copied", { name: m.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-[240px_1fr]" data-testid="bestiary">
      <div className="space-y-2">
        <Input placeholder={t("bestiary.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="bestiary-search" />
        <div className="scroll-thin max-h-[52vh] space-y-0.5 overflow-y-auto pr-1">
          {ownMatches.length > 0 && <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gold-400">{t("bestiary.campaign")}</p>}
          {ownMatches.map((c) => (
            <Row key={c.id} active={picked?.id === c.id} onClick={() => setPicked({ type: "character", id: c.id })} name={c.name} sub={c.kind === "npc" ? "NPC" : t("bestiary.custom")} testid={`bestiary-own-${c.name}`} />
          ))}
          <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gold-400">SRD 5.1</p>
          {srd.map((m) => (
            <Row key={m.id} active={picked?.id === m.id} onClick={() => setPicked({ type: "srd", id: m.id })} name={m.name} sub={`CR ${m.cr} · ${m.type}`} testid={`bestiary-${m.id}`} />
          ))}
          {srd.length === 0 && ownMatches.length === 0 && <p className="p-2 text-xs text-parchment-500">{t("bestiary.none")}</p>}
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        {(monster || character) && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-ink-700 bg-ink-900/60 p-2 text-sm">
            <label className="flex items-center gap-1">
              {t("bestiary.count")}
              <Input type="number" min={1} max={20} value={opts.count} className="h-8 w-16" onChange={(e) => setOpts({ ...opts, count: Math.max(1, Math.min(20, Math.trunc(Number(e.target.value) || 1))) })} data-testid="bestiary-count" />
            </label>
            {monster && (
              <Select className="h-8 w-auto" value={opts.hp} onChange={(e) => setOpts({ ...opts, hp: e.target.value as PlaceOptions["hp"] })} aria-label="HP" data-testid="bestiary-hp">
                <option value="average">{t("bestiary.hpAverage")}</option>
                <option value="roll">{t("bestiary.hpRoll")}</option>
              </Select>
            )}
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={opts.hidden} onChange={(e) => setOpts({ ...opts, hidden: e.target.checked })} data-testid="bestiary-hidden" />
              {t("bestiary.hidden")}
            </label>
            <Button size="sm" variant="primary" onClick={place} disabled={!onPlace || busy} title={onPlace ? undefined : t("bestiary.noMap")} data-testid="bestiary-place">
              {t("bestiary.place")}
            </Button>
            {monster && (
              <Button size="sm" variant="ghost" onClick={() => copyToCampaign(monster)} disabled={busy} data-testid="bestiary-copy">
                {t("bestiary.copy")}
              </Button>
            )}
            {!onPlace && <span className="text-xs text-parchment-500">{t("bestiary.noMap")}</span>}
          </div>
        )}
        {rulesetNote && monster && <p className="text-xs text-parchment-500">{t("bestiary.rulesetNote")}</p>}
        {monster ? (
          <StatBlock monster={monster} onRoll={onRoll} />
        ) : character ? (
          <OwnMonsterSummary c={character} />
        ) : (
          <p className="text-sm text-parchment-500">{t("bestiary.pick")}</p>
        )}
      </div>
    </div>
  );
}

function OwnMonsterSummary({ c }: { c: CharacterFull }) {
  const t = useT();
  const d = c.data;
  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-display text-lg text-gold-300">{c.name}</h3>
      <p className="text-parchment-300">
        AC {d.armorClass} · HP {d.hp.max} · Speed {d.speed} ft
      </p>
      {d.notes.description && <pre className="whitespace-pre-wrap font-sans text-xs text-parchment-400">{d.notes.description}</pre>}
      <a href={`/characters/${c.id}`} target="_blank" rel="noreferrer" className="text-xs text-gold-400 underline" data-testid="bestiary-edit-own">
        {t("bestiary.editSheet")}
      </a>
    </div>
  );
}

function Row({ active, onClick, name, sub, testid }: { active: boolean; onClick(): void; name: string; sub: string; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={cx("block w-full rounded px-2 py-1 text-left", active ? "bg-gold-500/15 text-gold-200" : "text-parchment-200 hover:bg-ink-800")}
    >
      <div className="truncate text-sm">{name}</div>
      <div className="truncate text-[11px] text-parchment-500">{sub}</div>
    </button>
  );
}
