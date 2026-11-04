import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { getSrdSpell, searchSpells, spellSheetEntry, templateShapeForArea, type CharacterData, type SrdSpell } from "@vtt/rules";
import { Button, Modal, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { toast } from "../../stores/toast";
import type { CampaignDetail } from "../../lib/types";
import { useTemplateStore } from "../templates/store";
import { newId } from "./format";

/** Present when the sheet is open at a campaign table and may act there (cast, give). */
export interface SheetTable {
  campaignId: string;
  myUserId: string;
  myCharacterId: string | null;
  canManageNpcs: boolean;
  canRollHidden: boolean;
  /** The sheet is open over the map, so a cast can drop its area there. */
  onMap: boolean;
}

export function sheetTableFor(detail: CampaignDetail, onMap: boolean): SheetTable {
  const caps = detail.me.capabilities;
  return {
    campaignId: detail.campaign.id,
    myUserId: detail.me.userId,
    myCharacterId: detail.me.activeCharacterId,
    canManageNpcs: caps.includes("npc.manage"),
    canRollHidden: caps.includes("dice.rollHidden"),
    onMap,
  };
}

/** Hooks the sheet runs around a server action: save pending edits first, reload after. */
export interface SheetActions {
  table: SheetTable;
  characterId: string;
  before(): Promise<void>;
  after(): void;
}

interface CastRoll {
  id: string;
  label: string;
  formula?: string;
  total?: number;
}

interface CastResult {
  characterId: string;
  spell: { name: string; level: number; srdId: string; concentration: boolean };
  slotLevel: number;
  slotSpent: boolean;
  saveDc: number | null;
  save: string | null;
  area: SrdSpell["area"] | null;
  rolls: CastRoll[];
}

/**
 * The last cast per character. Kept outside the sheet because the sheet remounts when
 * the server reports the character changed (the slot was spent).
 */
const useCastStore = create<{ last: Record<string, CastResult>; set(r: CastResult): void; clear(id: string): void }>((set) => ({
  last: {},
  set: (r) => set((s) => ({ last: { ...s.last, [r.characterId]: r } })),
  clear: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.last;
      return { last: rest };
    }),
}));

const ORD = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** Search the SRD spell list and add spells to the sheet with their level, school and tags filled in. */
export function SrdSpellPicker({ data, onAdd }: { data: CharacterData; onAdd(entry: CharacterData["spellcasting"]["spells"][number]): void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<number | "">("");
  const known = useMemo(() => new Set(data.spellcasting.spells.map((s) => s.srdId).filter(Boolean)), [data.spellcasting.spells]);
  const results = useMemo(() => searchSpells(q, level === "" ? {} : { level }).slice(0, 40), [q, level]);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="srd-spell-open">
        + Add from SRD
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="SRD spell library">
        <div className="mb-2 flex gap-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spells (e.g. fire, heal)" className="h-9 flex-1 rounded border border-ink-600 bg-ink-900 px-2 text-sm" data-testid="srd-spell-search" />
          <select aria-label="Spell level" value={level} onChange={(e) => setLevel(e.target.value === "" ? "" : Number(e.target.value))} className="rounded border border-ink-600 bg-ink-900 px-1 text-sm">
            <option value="">All levels</option>
            {ORD.map((o, l) => (
              <option key={l} value={l}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <ul className="scroll-thin max-h-[55vh] space-y-1 overflow-y-auto">
          {results.length === 0 && <li className="text-sm text-parchment-500">No SRD spells match.</li>}
          {results.map((s) => (
            <li key={s.id} className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-semibold">{s.name}</span>
                <span className="text-xs text-parchment-500">
                  {ORD[s.level]} · {s.school}
                  {s.concentration ? " · C" : ""}
                  {s.ritual ? " · R" : ""}
                </span>
                <Button
                  size="sm"
                  disabled={known.has(s.id)}
                  data-testid={`srd-add-${s.id}`}
                  onClick={() => {
                    onAdd(spellSheetEntry(s, newId()));
                    toast.success(`${s.name} added`);
                  }}
                >
                  {known.has(s.id) ? "Added" : "Add"}
                </Button>
              </div>
              <p className="mt-0.5 text-xs text-parchment-400">
                {s.castingTime} · {s.range} · {s.duration} — {s.summary}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-parchment-500">Spell data from the System Reference Document 5.1 (CC-BY-4.0). Add your own spells with the form on the sheet.</p>
      </Modal>
    </>
  );
}

/** "Cast" on one spell row: picks the slot level, spends it on the server and rolls. */
export function CastButton({ spell, data, actions }: { spell: CharacterData["spellcasting"]["spells"][number]; data: CharacterData; actions: SheetActions }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const free = data.spellcasting.slots.map((s, i) => ({ level: i + 1, left: s.max - s.used })).filter((s) => s.level >= spell.level && s.left > 0);
  const [slotLevel, setSlotLevel] = useState(free[0]?.level ?? spell.level);
  const [ritual, setRitual] = useState(false);
  const [hidden, setHidden] = useState(false);
  const setLast = useCastStore((s) => s.set);
  useEffect(() => {
    if (open) setSlotLevel(free[0]?.level ?? spell.level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cast = async () => {
    setBusy(true);
    try {
      await actions.before();
      const res = await api.post<CastResult>(`/api/campaigns/${actions.table.campaignId}/characters/${actions.characterId}/cast`, {
        spellId: spell.id,
        slotLevel,
        ritual,
        visibility: hidden ? "dm_only" : "public",
      });
      setLast(res);
      setOpen(false);
      actions.after();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cantrip = spell.level === 0;
  const canCast = cantrip || ritual || free.length > 0;
  return (
    <>
      <button className="rounded border border-arcane-400/60 px-1.5 text-[11px] text-arcane-400 hover:bg-arcane-500/20" onClick={() => (cantrip ? void cast() : setOpen(true))} disabled={busy} data-testid={`cast-${spell.name}`}>
        {busy ? "…" : "Cast"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Cast ${spell.name}`}>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs text-parchment-500">Spell slot</span>
            <select value={slotLevel} disabled={ritual} onChange={(e) => setSlotLevel(Number(e.target.value))} className="mt-1 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1" data-testid="cast-slot">
              {free.map((s) => (
                <option key={s.level} value={s.level}>
                  {ORD[s.level]} level ({s.left} left){s.level > spell.level ? " — upcast" : ""}
                </option>
              ))}
              {free.length === 0 && <option value={spell.level}>No slots left</option>}
            </select>
          </label>
          {spell.ritual && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ritual} onChange={(e) => setRitual(e.target.checked)} /> Cast as a ritual (+10 minutes, no slot)
            </label>
          )}
          {actions.table.canRollHidden && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Roll hidden (DM only)
            </label>
          )}
          {!spell.srdId && <p className="text-xs text-parchment-500">This is a custom spell: casting spends the slot and posts to the log, but no dice are rolled automatically.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!canCast} onClick={cast} data-testid="cast-confirm">
              Cast
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** What the last cast did: slot used, DC, rolls, and a button to drop its area on the map. */
export function LastCast({ characterId, onMap }: { characterId: string; onMap: boolean }) {
  const r = useCastStore((s) => s.last[characterId]);
  const clear = useCastStore((s) => s.clear);
  const place = useTemplateStore((s) => s.place);
  if (!r) return null;
  const area = r.area;
  return (
    <div className="mb-3 rounded border border-arcane-400/50 bg-arcane-500/10 p-2 text-sm" data-testid="last-cast">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">
          {r.spell.name}
          {r.slotSpent ? ` — ${ORD[r.slotLevel]}-level slot used` : r.spell.level === 0 ? " (cantrip)" : " (no slot)"}
        </span>
        <button className="text-xs text-parchment-500" aria-label="Dismiss" onClick={() => clear(characterId)}>
          ✕
        </button>
      </div>
      {r.saveDc !== null && r.save && (
        <p className="text-xs text-parchment-300">
          DC {r.saveDc} {r.save.toUpperCase()} save
        </p>
      )}
      {r.rolls.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {r.rolls.map((roll) => (
            <li key={roll.id} className="flex justify-between gap-2">
              <span className="truncate text-parchment-400">{roll.label}</span>
              <span className="font-mono text-parchment-100">{roll.total ?? "hidden"}</span>
            </li>
          ))}
        </ul>
      )}
      {area && !onMap && <p className="mt-1 text-xs text-parchment-500">Area: {area.sizeFt}-ft {area.shape}. Open the table to place it on the map.</p>}
      {area && onMap && (
        <Button
          size="sm"
          className="mt-2"
          data-testid="place-template"
          onClick={() => {
            const shape = templateShapeForArea(area.shape);
            place({ shape, size: area.sizeFt, width: area.widthFt ?? 5, color: "#e0603a", label: r.spell.name });
          }}
        >
          📐 Place {area.sizeFt}-ft {area.shape} on the map
        </Button>
      )}
    </div>
  );
}

/** True when the spell entry links to SRD data with an area (used for the row tag). */
export const srdArea = (srdId: string) => (srdId ? (getSrdSpell(srdId)?.area ?? null) : null);

/** "Give" on an inventory row: moves some of the stack to another character at the table. */
export function GiveButton({ item, actions }: { item: CharacterData["inventory"][number]; actions: SheetActions }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Array<{ id: string; name: string }> | null>(null);
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setQty(1);
    api
      .get<{ characters: Array<{ id: string; name: string }> }>(`/api/campaigns/${actions.table.campaignId}/give-targets`)
      .then((r) => {
        const list = r.characters.filter((c) => c.id !== actions.characterId);
        setTargets(list);
        setTo((cur) => (list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? "")));
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [open, actions.table.campaignId, actions.characterId]);

  const give = async () => {
    setBusy(true);
    try {
      await actions.before();
      const r = await api.post<{ to: { name: string }; item: string; quantity: number }>(`/api/campaigns/${actions.table.campaignId}/characters/${actions.characterId}/give`, {
        itemId: item.id,
        quantity: qty,
        toCharacterId: to,
      });
      toast.success(`Gave ${r.quantity}× ${r.item} to ${r.to.name}`);
      setOpen(false);
      actions.after();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className={cx("text-xs text-gold-400 hover:underline", item.quantity < 1 && "opacity-40")} disabled={item.quantity < 1} onClick={() => setOpen(true)} data-testid={`give-${item.name}`}>
        Give
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Give ${item.name}`}>
        {targets === null ? (
          <p className="text-sm text-parchment-500">Loading…</p>
        ) : targets.length === 0 ? (
          <p className="text-sm text-parchment-500">No other characters at this table yet.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs text-parchment-500">To</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1" data-testid="give-to">
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-parchment-500">Quantity (you have {item.quantity})</span>
              <input type="number" min={1} max={item.quantity} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(item.quantity, Number(e.target.value) | 0)))} className="mt-1 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1" data-testid="give-qty" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} disabled={!to} onClick={give} data-testid="give-confirm">
                Give
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** "Concentrating on X" with a Con save button and End. */
export function ConcentrationBadge({ spell, onSave, onEnd }: { spell: string; onSave?: () => void; onEnd?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-arcane-400/60 bg-arcane-500/10 px-2 py-1 text-xs" data-testid="concentration">
      <span className="flex-1 text-parchment-100">
        🔮 Concentrating on <b>{spell}</b>
      </span>
      {onSave && (
        <button className="rounded border border-ink-600 px-1.5 py-0.5 hover:border-gold-500" onClick={onSave} data-testid="concentration-save">
          Con save
        </button>
      )}
      {onEnd && (
        <button
          className="rounded border border-ink-600 px-1.5 py-0.5 text-blood-400 hover:border-blood-400"
          disabled={busy}
          data-testid="concentration-end"
          onClick={() => {
            setBusy(true);
            onEnd()
              .catch((e) => toast.error(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          End
        </button>
      )}
    </div>
  );
}

export const endConcentration = (campaignId: string, characterId: string) => api.post(`/api/campaigns/${campaignId}/characters/${characterId}/concentration/end`);
