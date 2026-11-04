import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";

interface SessionSummary {
  id: string;
  number: number;
  name: string;
  status: "active" | "paused" | "ended";
  startedAt: string;
  endedAt: string | null;
  recap: string;
  recapPublished: boolean;
}

interface TimelineEvent {
  id: string;
  sessionId: string | null;
  title: string;
  body: string;
  inWorldDate: string;
  sortKey: number;
  visibility?: "players" | "dm";
  createdAt: string;
}

interface Timeline {
  sessions: SessionSummary[];
  events: TimelineEvent[];
}

const EMPTY_EVENT = { title: "", body: "", inWorldDate: "", sessionId: "", visibility: "players" as "players" | "dm" };

/**
 * The campaign's story so far: every game session with its recap, plus story events
 * the DM records. Players see published recaps and "players" events only (filtered on
 * the server).
 */
export function TimelinePanel({ open, onClose, campaignId, isDm, canEditEvents }: { open: boolean; onClose(): void; campaignId: string; isDm: boolean; canEditEvents: boolean }) {
  const t = useT();
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY_EVENT & { id?: string }>(EMPTY_EVENT);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Timeline>(`/api/campaigns/${campaignId}/timeline`)
      .then((r) => (setData(r), setError(null)))
      .catch((e) => setError(errorMessage(e)));
  }, [campaignId]);

  useEffect(() => {
    if (!open) return;
    load();
    const s = getSocket();
    const onChanged = (p: { campaignId: string; reason: string }) => p.campaignId === campaignId && (p.reason === "timeline" || p.reason === "session") && load();
    s.on("campaign:changed", onChanged);
    return () => {
      s.off("campaign:changed", onChanged);
    };
  }, [open, campaignId, load]);

  const saveEvent = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const body = { title: form.title.trim(), body: form.body, inWorldDate: form.inWorldDate.trim(), sessionId: form.sessionId || null, visibility: form.visibility };
      if (form.id) await api.patch(`/api/campaigns/${campaignId}/timeline-events/${form.id}`, body);
      else await api.post(`/api/campaigns/${campaignId}/timeline-events`, body);
      setForm(EMPTY_EVENT);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (ev: TimelineEvent) => {
    if (!window.confirm(t("timeline.deleteConfirm", { title: ev.title }))) return;
    try {
      await api.del(`/api/campaigns/${campaignId}/timeline-events/${ev.id}`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const loose = data?.events.filter((e) => !e.sessionId || !data.sessions.some((s) => s.id === e.sessionId)) ?? [];

  return (
    <Modal open={open} onClose={onClose} title={t("timeline.title")} wide>
      {error && <p className="text-sm text-blood-400">{error}</p>}
      {!data ? (
        !error && <p className="text-sm text-parchment-500">{t("common.loading")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="timeline">
          <ol className="relative space-y-4 border-l border-ink-600 pl-5">
            {data.sessions.length === 0 && loose.length === 0 && <li className="text-sm text-parchment-500">{t("timeline.empty")}</li>}
            {loose.length > 0 && (
              <li>
                <Dot />
                <p className="text-xs uppercase tracking-wider text-parchment-500">{t("timeline.storyEvents")}</p>
                <EventList events={loose} canEdit={canEditEvents} onEdit={(ev) => setForm({ ...ev, sessionId: ev.sessionId ?? "", visibility: ev.visibility ?? "players" })} onDelete={removeEvent} />
              </li>
            )}
            {data.sessions.map((s) => (
              <li key={s.id} data-testid={`timeline-session-${s.number}`}>
                <Dot active={s.status !== "ended"} />
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="font-display text-lg text-gold-300">
                    {t("timeline.session", { n: s.number })}: {s.name}
                  </h3>
                  <span className="text-xs text-parchment-500">{new Date(s.startedAt).toLocaleDateString()}</span>
                  {s.status !== "ended" && <Badge tone="green">{t(s.status === "active" ? "timeline.playing" : "timeline.paused")}</Badge>}
                </div>
                {isDm ? (
                  <RecapEditor key={`${s.id}:${s.recap}:${s.recapPublished}`} campaignId={campaignId} session={s} onSaved={load} />
                ) : s.recapPublished && s.recap ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-parchment-200" data-testid="recap-text">
                    {s.recap}
                  </p>
                ) : (
                  <p className="mt-1 text-xs italic text-parchment-500">{t("timeline.noRecap")}</p>
                )}
                <EventList
                  events={data.events.filter((e) => e.sessionId === s.id)}
                  canEdit={canEditEvents}
                  onEdit={(ev) => setForm({ ...ev, sessionId: ev.sessionId ?? "", visibility: ev.visibility ?? "players" })}
                  onDelete={removeEvent}
                />
              </li>
            ))}
          </ol>
          {canEditEvents && (
            <div className="space-y-2 rounded-md border border-ink-700 p-3 text-sm" data-testid="timeline-event-form">
              <p className="text-xs font-semibold uppercase tracking-wider text-gold-400">{form.id ? t("timeline.editEvent") : t("timeline.addEvent")}</p>
              <Field label={t("timeline.eventTitle")}>
                <Input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="event-title" />
              </Field>
              <Field label={t("timeline.inWorldDate")} hint={t("timeline.inWorldDateHint")}>
                <Input value={form.inWorldDate} maxLength={80} onChange={(e) => setForm({ ...form, inWorldDate: e.target.value })} data-testid="event-date" />
              </Field>
              <Field label={t("timeline.inSession")}>
                <Select value={form.sessionId} onChange={(e) => setForm({ ...form, sessionId: e.target.value })} data-testid="event-session">
                  <option value="">{t("timeline.noSession")}</option>
                  {data.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t("timeline.session", { n: s.number })}: {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("timeline.visibility")}>
                <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as "players" | "dm" })} data-testid="event-visibility">
                  <option value="players">{t("timeline.visPlayers")}</option>
                  <option value="dm">{t("timeline.visDm")}</option>
                </Select>
              </Field>
              <Field label={t("timeline.details")}>
                <Textarea value={form.body} maxLength={20000} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-20" />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" loading={busy} disabled={!form.title.trim()} onClick={saveEvent} data-testid="event-save">
                  {form.id ? t("common.save") : t("timeline.add")}
                </Button>
                {form.id && (
                  <Button size="sm" variant="ghost" onClick={() => setForm(EMPTY_EVENT)}>
                    {t("common.cancel")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Dot({ active }: { active?: boolean }) {
  return <span className={`absolute -left-[7px] mt-2 h-3 w-3 rounded-full border-2 border-ink-900 ${active ? "bg-moss-400" : "bg-gold-500"}`} />;
}

function EventList({ events, canEdit, onEdit, onDelete }: { events: TimelineEvent[]; canEdit: boolean; onEdit(e: TimelineEvent): void; onDelete(e: TimelineEvent): void }) {
  const t = useT();
  if (events.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {events.map((ev) => (
        <li key={ev.id} className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-sm" data-testid="timeline-event">
          <div className="flex items-center gap-2">
            <span className="flex-1 font-semibold text-parchment-100">{ev.title}</span>
            {ev.inWorldDate && <span className="text-xs text-parchment-400">{ev.inWorldDate}</span>}
            {ev.visibility === "dm" && <Badge tone="blue">{t("timeline.visDmShort")}</Badge>}
            {canEdit && (
              <>
                <button className="text-xs text-gold-400 hover:underline" onClick={() => onEdit(ev)}>
                  {t("audio.edit")}
                </button>
                <button className="text-xs text-blood-400" aria-label={t("common.delete")} onClick={() => onDelete(ev)}>
                  ✕
                </button>
              </>
            )}
          </div>
          {ev.body && <p className="mt-0.5 whitespace-pre-wrap text-xs text-parchment-400">{ev.body}</p>}
        </li>
      ))}
    </ul>
  );
}

function RecapEditor({ campaignId, session, onSaved }: { campaignId: string; session: SessionSummary; onSaved(): void }) {
  const t = useT();
  const [text, setText] = useState(session.recap);
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = text !== session.recap;
  const save = async (patch: { recap?: string; recapPublished?: boolean }, what: string) => {
    setBusy(what);
    try {
      await api.patch(`/api/campaigns/${campaignId}/sessions/${session.id}`, patch);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const draft = async () => {
    if (text.trim() && !window.confirm(t("timeline.replaceRecap"))) return;
    setBusy("draft");
    try {
      const r = await api.get<{ draft: string }>(`/api/campaigns/${campaignId}/sessions/${session.id}/recap-draft`);
      setText(r.draft);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-2 space-y-2" data-testid={`recap-editor-${session.number}`}>
      <Textarea value={text} maxLength={50000} onChange={(e) => setText(e.target.value)} placeholder={t("timeline.recapPlaceholder")} className="min-h-28 text-sm" data-testid="recap-input" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" loading={busy === "draft"} onClick={draft} data-testid="recap-draft">
          ✨ {t("timeline.draftFromLog")}
        </Button>
        <Button size="sm" loading={busy === "save"} disabled={!dirty} onClick={() => save({ recap: text }, "save")} data-testid="recap-save">
          {t("common.save")}
        </Button>
        <Button
          size="sm"
          variant={session.recapPublished ? "ghost" : "primary"}
          loading={busy === "publish"}
          disabled={!text.trim()}
          onClick={() => save({ recap: text, recapPublished: !session.recapPublished }, "publish")}
          data-testid="recap-publish"
        >
          {session.recapPublished ? t("timeline.unpublish") : t("timeline.publish")}
        </Button>
        <span className="text-xs text-parchment-500">{session.recapPublished ? t("timeline.publishedHint") : t("timeline.draftHint")}</span>
      </div>
    </div>
  );
}
