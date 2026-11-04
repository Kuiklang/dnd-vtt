import { useMemo, useRef, useState } from "react";
import { Badge, Button, Field, Input, Select, Textarea, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { CampaignDetail } from "../../lib/types";
import { IMAGE_ACCEPT, uploadImage } from "../../lib/upload";
import { toast } from "../../stores/toast";
import { useT, type MessageKey } from "../../i18n";
import { Markdown } from "./Markdown";
import type { Journal } from "./useJournal";
import type { JournalEntry, JournalVisibility } from "./types";

interface Props {
  detail: CampaignDetail;
  journal: Journal;
  /** DM/co-DM: sees and edits every shared entry, may make DM-only entries. */
  manager: boolean;
  canShow: boolean;
}

type Draft = { id: string | null; version: number; title: string; body: string; folder: string; visibility: JournalVisibility; sharedWith: string[]; imageAssetId: string | null; imageUrl: string | null; pinned: boolean };

const VIS_KEYS: Record<JournalVisibility, MessageKey> = { gm: "journal.vis.gm", all: "journal.vis.all", selected: "journal.vis.selected", author: "journal.vis.author" };

/** Campaign journal: lore, notes and handouts, each with who-can-read-it set on the server. */
export function JournalPanel({ detail, journal, manager, canShow }: Props) {
  const t = useT();
  const campaignId = detail.campaign.id;
  const base = `/api/campaigns/${campaignId}/journal`;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const others = detail.members.filter((m) => m.userId !== detail.me.userId);
  const nameOf = (id: string | null) => detail.members.find((m) => m.userId === id)?.user.displayName ?? "—";

  const entries = journal.entries ?? [];
  const filtered = entries.filter((e) => !q.trim() || `${e.title} ${e.folder} ${e.body}`.toLowerCase().includes(q.trim().toLowerCase()));
  const folders = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const e of filtered) map.set(e.folder, [...(map.get(e.folder) ?? []), e]);
    return [...map.entries()];
  }, [filtered]);
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const startNew = () =>
    setDraft({ id: null, version: 0, title: "", body: "", folder: selected?.folder ?? "", visibility: manager ? "gm" : "author", sharedWith: [], imageAssetId: null, imageUrl: null, pinned: false });
  const startEdit = (e: JournalEntry) => setDraft({ ...e });

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = {
        title: draft.title.trim(),
        body: draft.body,
        folder: draft.folder.trim(),
        visibility: draft.visibility,
        sharedWith: draft.visibility === "selected" ? draft.sharedWith : [],
        imageAssetId: draft.imageAssetId,
        ...(manager ? { pinned: draft.pinned } : {}),
      };
      const { entry } = draft.id
        ? await api.put<{ entry: JournalEntry }>(`${base}/${draft.id}`, { ...body, expectedVersion: draft.version })
        : await api.post<{ entry: JournalEntry }>(base, body);
      journal.upsertLocal(entry);
      setSelectedId(entry.id);
      setDraft(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: JournalEntry) => {
    if (!window.confirm(t("journal.deleteConfirm", { title: e.title }))) return;
    try {
      await api.del(`${base}/${e.id}`);
      journal.removeLocal(e.id);
      setSelectedId(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const show = async (e: JournalEntry, to: "all" | string[]) => {
    try {
      const { entry } = await api.post<{ entry: JournalEntry }>(`${base}/${e.id}/show`, { to });
      journal.upsertLocal(entry);
      toast.success(t("journal.shown"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const attach = async (file: File) => {
    if (!draft) return;
    setBusy(true);
    try {
      const asset = await uploadImage(file, "handout", campaignId);
      setDraft({ ...draft, imageAssetId: asset.id, imageUrl: asset.url });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const visOptions: JournalVisibility[] = manager ? ["gm", "all", "selected", "author"] : ["author", "selected", "all"];

  return (
    <div className="grid gap-3 md:grid-cols-[230px_1fr]" data-testid="journal">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input placeholder={t("journal.search")} value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
          {detail.me.role !== "spectator" && (
            <Button size="sm" variant="primary" onClick={startNew} data-testid="journal-new">
              +
            </Button>
          )}
        </div>
        <div className="scroll-thin max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {journal.entries === null && <p className="text-xs text-parchment-500">{t("table.loading")}</p>}
          {journal.entries !== null && entries.length === 0 && <p className="text-xs text-parchment-500">{t("journal.empty")}</p>}
          {folders.map(([folder, list]) => (
            <div key={folder}>
              {folder && <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gold-400">{folder}</p>}
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(e.id);
                    setDraft(null);
                  }}
                  data-testid={`journal-item-${e.title}`}
                  className={cx("flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm", selectedId === e.id ? "bg-gold-500/15 text-gold-200" : "hover:bg-ink-800")}
                >
                  {e.pinned && <span title={t("journal.pinned")}>📌</span>}
                  {e.imageUrl && <span title={t("journal.handout")}>🖼</span>}
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <VisDot v={e.visibility} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        {draft ? (
          <div className="space-y-2" data-testid="journal-editor">
            <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
              <Field label={t("journal.title")}>
                <Input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="journal-title" />
              </Field>
              <Field label={t("journal.folder")}>
                <Input value={draft.folder} maxLength={60} onChange={(e) => setDraft({ ...draft, folder: e.target.value })} data-testid="journal-folder" />
              </Field>
            </div>
            <Field label={t("journal.visibility")}>
              <Select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as JournalVisibility })} data-testid="journal-visibility">
                {visOptions.map((v) => (
                  <option key={v} value={v}>
                    {t(VIS_KEYS[v])}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.visibility === "selected" && (
              <div className="flex flex-wrap gap-2 text-sm" data-testid="journal-share">
                {others.map((m) => (
                  <label key={m.userId} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={draft.sharedWith.includes(m.userId)}
                      onChange={(e) => setDraft({ ...draft, sharedWith: e.target.checked ? [...draft.sharedWith, m.userId] : draft.sharedWith.filter((x) => x !== m.userId) })}
                      data-testid={`journal-share-${m.user.displayName}`}
                    />
                    {m.user.displayName}
                  </label>
                ))}
              </div>
            )}
            <Field label={t("journal.body")} hint={t("journal.markdownHint")}>
              <Textarea rows={10} value={draft.body} maxLength={100000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} data-testid="journal-body" className="font-mono text-xs" />
            </Field>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} className="hidden" data-testid="journal-image-file" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void attach(f);
                e.target.value = "";
              }} />
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                🖼 {draft.imageAssetId ? t("journal.replaceImage") : t("journal.addImage")}
              </Button>
              {draft.imageUrl && (
                <>
                  <img src={draft.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                  <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, imageAssetId: null, imageUrl: null })}>
                    {t("journal.removeImage")}
                  </Button>
                </>
              )}
              {manager && (
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
                  {t("journal.pinned")}
                </label>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  {t("journal.cancel")}
                </Button>
                <Button size="sm" variant="primary" onClick={save} disabled={busy || !draft.title.trim()} data-testid="journal-save">
                  {t("journal.save")}
                </Button>
              </div>
            </div>
          </div>
        ) : selected ? (
          <article className="space-y-2" data-testid="journal-view">
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="min-w-0 flex-1 font-display text-xl text-gold-300">{selected.title}</h3>
              <Badge tone={selected.visibility === "gm" ? "red" : selected.visibility === "all" ? "green" : "default"}>{t(VIS_KEYS[selected.visibility])}</Badge>
            </div>
            <p className="text-xs text-parchment-500">
              {t("journal.by", { name: nameOf(selected.authorId) })} · {new Date(selected.updatedAt).toLocaleString()}
              {selected.visibility === "selected" && selected.sharedWith.length > 0 && ` · ${t("journal.sharedWith")}: ${selected.sharedWith.map(nameOf).join(", ")}`}
            </p>
            <div className="flex flex-wrap gap-2">
              {selected.canEdit && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(selected)} data-testid="journal-edit">
                    {t("journal.edit")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(selected)}>
                    {t("journal.delete")}
                  </Button>
                </>
              )}
              {canShow && selected.visibility !== "author" && (
                <ShowMenu others={others.filter((m) => m.role !== "owner" && m.role !== "dm" && m.role !== "co_dm")} onShow={(to) => show(selected, to)} />
              )}
            </div>
            {selected.imageUrl && <img src={selected.imageUrl} alt={selected.title} className="max-h-[45vh] rounded border border-ink-700" data-testid="journal-image" />}
            <Markdown text={selected.body} />
          </article>
        ) : (
          <p className="text-sm text-parchment-500">{t("journal.pick")}</p>
        )}
      </div>
    </div>
  );
}

function VisDot({ v }: { v: JournalVisibility }) {
  const t = useT();
  const color = v === "gm" ? "bg-blood-500" : v === "all" ? "bg-moss-400" : v === "selected" ? "bg-gold-400" : "bg-ink-500";
  return <span className={cx("h-2 w-2 shrink-0 rounded-full", color)} title={t(VIS_KEYS[v])} />;
}

function ShowMenu({ others, onShow }: { others: CampaignDetail["members"]; onShow(to: "all" | string[]): void }) {
  const t = useT();
  const [to, setTo] = useState<string>("all");
  return (
    <span className="flex items-center gap-1">
      <Select className="h-8 w-auto text-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("journal.showTo")} data-testid="journal-show-to">
        <option value="all">{t("journal.everyone")}</option>
        {others.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.user.displayName}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="primary" onClick={() => onShow(to === "all" ? "all" : [to])} data-testid="journal-show">
        📜 {t("journal.show")}
      </Button>
    </span>
  );
}
