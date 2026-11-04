import { useMemo, useState } from "react";
import { encounterXp, getSrdMonster, searchMonsters } from "@vtt/rules";
import { Button, Input, Select, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { CharacterFull } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import type { TokenInput } from "../table/useTable";
import { characterPlacements, srdPlacements } from "./placement";
import type { Encounter, EncounterEntry } from "./types";

interface Props {
  campaignId: string;
  partySize: number;
  onPlace?: (tokens: TokenInput[]) => Promise<string[]>;
  /** Starts combat with the placed tokens (or adds them to the running one). */
  onFight?: (tokenIds: string[]) => Promise<unknown>;
}

const blank = (): { id: string | null; version: number; name: string; notes: string; entries: EncounterEntry[] } => ({ id: null, version: 0, name: "", notes: "", entries: [] });

/** Build, save and deploy encounters. Difficulty tables aren't in the SRD, so this shows XP totals only. */
export function EncounterPanel({ campaignId, partySize, onPlace, onFight }: Props) {
  const t = useT();
  const base = `/api/campaigns/${campaignId}/encounters`;
  const list = useAsync(() => api.get<{ encounters: Encounter[] }>(base).then((r) => r.encounters), [base]);
  const own = useAsync(
    () => api.get<{ characters: CharacterFull[] }>(`/api/campaigns/${campaignId}/characters`).then((r) => r.characters.filter((c) => c.kind !== "pc")),
    [campaignId],
  );
  const [draft, setDraft] = useState(blank);
  const [add, setAdd] = useState("srd:goblin");
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const total = encounterXp(draft.entries);
  const options = useMemo(() => searchMonsters(""), []);

  const addEntry = () => {
    const [type, id] = add.split(":") as ["srd" | "character", string];
    const existing = draft.entries.findIndex((e) => e.ref.type === type && e.ref.id === id);
    if (existing >= 0) {
      const entries = [...draft.entries];
      entries[existing] = { ...entries[existing]!, count: Math.min(50, entries[existing]!.count + 1) };
      return setDraft({ ...draft, entries });
    }
    if (type === "srd") {
      const m = getSrdMonster(id);
      if (m) setDraft({ ...draft, entries: [...draft.entries, { ref: { type, id }, name: m.name, count: 1, xp: m.xp }] });
    } else {
      const c = own.data?.find((x) => x.id === id);
      if (c) setDraft({ ...draft, entries: [...draft.entries, { ref: { type, id }, name: c.name, count: 1, xp: 0 }] });
    }
  };
  const setEntry = (i: number, patch: Partial<EncounterEntry>) => setDraft({ ...draft, entries: draft.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: draft.name.trim(), notes: draft.notes, entries: draft.entries };
      const { encounter } = draft.id
        ? await api.put<{ encounter: Encounter }>(`${base}/${draft.id}`, { ...body, expectedVersion: draft.version })
        : await api.post<{ encounter: Encounter }>(base, body);
      setDraft({ id: encounter.id, version: encounter.version, name: encounter.name, notes: encounter.notes, entries: encounter.entries });
      await list.reload();
      toast.success(t("encounter.saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id || !window.confirm(t("encounter.deleteConfirm"))) return;
    try {
      await api.del(`${base}/${draft.id}`);
      setDraft(blank());
      await list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const deploy = async (fight: boolean) => {
    if (!onPlace) return;
    const tokens: TokenInput[] = [];
    for (const e of draft.entries) {
      if (e.ref.type === "srd") {
        const m = getSrdMonster(e.ref.id);
        if (m) tokens.push(...srdPlacements(m, { count: e.count, hp: "roll", hidden }));
      } else {
        const c = own.data?.find((x) => x.id === e.ref.id);
        if (c) tokens.push(...characterPlacements(c, { count: e.count, hidden }));
        else toast.error(t("encounter.missing", { name: e.name }));
      }
    }
    if (!tokens.length) return;
    setBusy(true);
    try {
      const ids = await onPlace(tokens);
      if (fight && onFight) await onFight(ids);
      toast.success(t("bestiary.placed", { n: ids.length }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-[200px_1fr]" data-testid="encounters">
      <div className="space-y-1">
        <Button size="sm" variant="ghost" className="w-full" onClick={() => setDraft(blank())} data-testid="encounter-new">
          + {t("encounter.new")}
        </Button>
        {(list.data ?? []).map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setDraft({ id: e.id, version: e.version, name: e.name, notes: e.notes, entries: e.entries })}
            className={`block w-full rounded px-2 py-1 text-left text-sm ${draft.id === e.id ? "bg-gold-500/15 text-gold-200" : "hover:bg-ink-800"}`}
          >
            <div className="truncate">{e.name}</div>
            <div className="text-[11px] text-parchment-500">{e.totalXp.toLocaleString()} XP</div>
          </button>
        ))}
      </div>
      <div className="min-w-0 space-y-2 text-sm">
        <Input placeholder={t("encounter.name")} value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="encounter-name" />
        <div className="flex gap-2">
          <Select value={add} onChange={(e) => setAdd(e.target.value)} className="h-8 flex-1" aria-label={t("encounter.addMonster")} data-testid="encounter-pick">
            {(own.data ?? []).length > 0 && (
              <optgroup label={t("bestiary.campaign")}>
                {own.data!.map((c) => (
                  <option key={c.id} value={`character:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="SRD 5.1">
              {options.map((m) => (
                <option key={m.id} value={`srd:${m.id}`}>
                  {m.name} (CR {m.cr})
                </option>
              ))}
            </optgroup>
          </Select>
          <Button size="sm" onClick={addEntry} data-testid="encounter-add">
            + {t("encounter.addMonster")}
          </Button>
        </div>
        <table className="w-full text-left text-sm">
          <tbody>
            {draft.entries.map((e, i) => (
              <tr key={`${e.ref.type}:${e.ref.id}`} className="border-b border-ink-800">
                <td className="py-1">{e.name}</td>
                <td className="w-20">
                  <Input type="number" min={1} max={50} value={e.count} className="h-7 w-16" onChange={(ev) => setEntry(i, { count: Math.max(1, Math.min(50, Math.trunc(Number(ev.target.value) || 1))) })} aria-label={`${e.name} count`} data-testid={`encounter-count-${i}`} />
                </td>
                <td className="w-24">
                  {e.ref.type === "character" ? (
                    <Input type="number" min={0} value={e.xp} className="h-7 w-20" onChange={(ev) => setEntry(i, { xp: Math.max(0, Math.trunc(Number(ev.target.value) || 0)) })} aria-label={`${e.name} XP`} />
                  ) : (
                    <span className="text-parchment-400">{e.xp} XP</span>
                  )}
                </td>
                <td className="w-8 text-right">
                  <button type="button" aria-label="Remove" className="text-parchment-500 hover:text-blood-400" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-parchment-300" data-testid="encounter-xp">
          {t("encounter.total", { xp: total.toLocaleString() })}
          {partySize > 0 && ` · ${t("encounter.perPlayer", { xp: Math.floor(total / partySize).toLocaleString(), n: partySize })}`}
        </p>
        <p className="text-xs text-parchment-500">{t("encounter.noDifficulty")}</p>
        <Textarea rows={2} placeholder={t("encounter.notes")} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={save} disabled={busy || !draft.name.trim()} data-testid="encounter-save">
            {t("encounter.save")}
          </Button>
          {draft.id && (
            <Button size="sm" variant="ghost" onClick={remove}>
              {t("encounter.delete")}
            </Button>
          )}
          <span className="mx-1 h-5 w-px bg-ink-700" />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} data-testid="encounter-hidden" />
            {t("bestiary.hidden")}
          </label>
          <Button size="sm" onClick={() => deploy(false)} disabled={!onPlace || busy || !draft.entries.length} data-testid="encounter-place">
            {t("encounter.place")}
          </Button>
          <Button size="sm" variant="primary" onClick={() => deploy(true)} disabled={!onPlace || !onFight || busy || !draft.entries.length} data-testid="encounter-fight">
            ⚔ {t("encounter.fight")}
          </Button>
          {!onPlace && <span className="text-xs text-parchment-500">{t("bestiary.noMap")}</span>}
        </div>
      </div>
    </div>
  );
}
