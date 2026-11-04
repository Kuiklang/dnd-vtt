import { useState } from "react";
import { Button, Field, Input, Textarea, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import type { RandomTable, RandomTableEntry } from "./types";

/** "1-2 Clear skies" / "3: Rain" / "4–6 Storm" → entries; returns the line numbers it couldn't read. */
export function parseEntries(text: string): { entries: RandomTableEntry[]; bad: number[] } {
  const entries: RandomTableEntry[] = [];
  const bad: number[] = [];
  text.split("\n").forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    const m = /^(\d+)\s*(?:[-–—]\s*(\d+))?\s*[:.)]?\s+(.+)$/.exec(l);
    if (!m) return bad.push(i + 1);
    const min = Number(m[1]);
    entries.push({ min, max: m[2] ? Number(m[2]) : min, text: m[3]!.trim() });
  });
  return { entries, bad };
}
export const formatEntries = (entries: RandomTableEntry[]) => entries.map((e) => `${e.min === e.max ? e.min : `${e.min}-${e.max}`} ${e.text}`).join("\n");

const EXAMPLE = { name: "", formula: "1d6", text: "1-2 Clear skies\n3-4 Light rain\n5 Fog\n6 Thunderstorm" };

export function TablesPanel({ campaignId }: { campaignId: string }) {
  const t = useT();
  const base = `/api/campaigns/${campaignId}/tables`;
  const list = useAsync(() => api.get<{ tables: RandomTable[] }>(base).then((r) => r.tables), [base]);
  const [edit, setEdit] = useState<{ id: string | null; version: number; name: string; formula: string; text: string } | null>(null);
  const [results, setResults] = useState<Array<{ table: string; total: number; text: string; visibility: string }>>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit) return;
    const { entries, bad } = parseEntries(edit.text);
    if (bad.length) return toast.error(t("tables.badLines", { lines: bad.join(", ") }));
    setBusy(true);
    try {
      const body = { name: edit.name.trim(), formula: edit.formula.trim(), entries };
      await (edit.id ? api.put(`${base}/${edit.id}`, { ...body, expectedVersion: edit.version }) : api.post(base, body));
      setEdit(null);
      await list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rollOn = async (tbl: RandomTable, visibility: "dm_only" | "public") => {
    try {
      const r = await api.post<{ roll: { total: number }; entry: RandomTableEntry | null }>(`${base}/${tbl.id}/roll`, { visibility });
      setResults((list) => [{ table: tbl.name, total: r.roll.total, text: r.entry?.text ?? t("tables.noEntry"), visibility }, ...list].slice(0, 8));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (tbl: RandomTable) => {
    if (!window.confirm(t("tables.deleteConfirm", { name: tbl.name }))) return;
    try {
      await api.del(`${base}/${tbl.id}`);
      await list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_260px]" data-testid="tables">
      <div className="space-y-2">
        {!edit && (
          <Button size="sm" variant="primary" onClick={() => setEdit({ id: null, version: 0, ...EXAMPLE })} data-testid="table-new">
            + {t("tables.new")}
          </Button>
        )}
        {edit && (
          <div className="space-y-2 rounded-md border border-ink-700 p-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
              <Field label={t("tables.name")}>
                <Input value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="table-name" />
              </Field>
              <Field label={t("tables.formula")}>
                <Input value={edit.formula} maxLength={20} onChange={(e) => setEdit({ ...edit, formula: e.target.value })} data-testid="table-formula" />
              </Field>
            </div>
            <Field label={t("tables.entries")} hint={t("tables.entriesHint")}>
              <Textarea rows={7} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} className="font-mono text-xs" data-testid="table-entries" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                {t("journal.cancel")}
              </Button>
              <Button size="sm" variant="primary" onClick={save} disabled={busy || !edit.name.trim()} data-testid="table-save">
                {t("journal.save")}
              </Button>
            </div>
          </div>
        )}
        {(list.data ?? []).map((tbl) => (
          <div key={tbl.id} className="rounded-md border border-ink-700 bg-ink-900/60 p-2 text-sm" data-testid={`table-${tbl.name}`}>
            <div className="flex flex-wrap items-center gap-2">
              <b className="min-w-0 flex-1 truncate text-parchment-50">{tbl.name}</b>
              <span className="text-xs text-parchment-500">{tbl.formula}</span>
              <Button size="sm" onClick={() => rollOn(tbl, "dm_only")} data-testid={`table-roll-${tbl.name}`} title={t("tables.rollHidden")}>
                🎲 {t("tables.roll")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => rollOn(tbl, "public")} title={t("tables.rollPublic")}>
                {t("tables.public")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit({ id: tbl.id, version: tbl.version, name: tbl.name, formula: tbl.formula, text: formatEntries(tbl.entries) })}>
                {t("journal.edit")}
              </Button>
              <button type="button" aria-label="Delete" className="text-parchment-500 hover:text-blood-400" onClick={() => remove(tbl)}>
                ✕
              </button>
            </div>
            <p className="mt-1 truncate text-xs text-parchment-500">{tbl.entries.map((e) => e.text).join(" · ")}</p>
          </div>
        ))}
        {list.data?.length === 0 && !edit && <p className="text-sm text-parchment-500">{t("tables.empty")}</p>}
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gold-400">{t("tables.results")}</h4>
        <ul className="space-y-1 text-sm" data-testid="table-results">
          {results.map((r, i) => (
            <li key={i} className={cx("rounded border border-ink-700 p-1.5", i === 0 && "border-gold-600/60")}>
              <span className="text-xs text-parchment-500">
                {r.table} · {r.total} {r.visibility === "dm_only" ? "🔒" : ""}
              </span>
              <div className="text-parchment-50">{r.text}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
