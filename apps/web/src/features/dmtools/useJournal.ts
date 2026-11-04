import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import type { JournalEntry } from "./types";

const order = (a: JournalEntry, b: JournalEntry) => Number(b.pinned) - Number(a.pinned) || a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title);

/**
 * The journal entries this viewer may read, kept live: the server pushes an upsert when
 * an entry becomes visible or changes, and a removal when it's deleted or hidden again.
 */
export function useJournal(campaignId: string) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ entries: JournalEntry[] }>(`/api/campaigns/${campaignId}/journal`);
      setEntries(r.entries.sort(order));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
    const s = getSocket();
    const onUpsert = (p: { campaignId: string; entry: JournalEntry }) => {
      if (p.campaignId !== campaignId) return;
      setEntries((list) => [...(list ?? []).filter((e) => e.id !== p.entry.id), p.entry].sort(order));
    };
    const onRemove = (p: { campaignId: string; id: string }) => {
      if (p.campaignId !== campaignId) return;
      setEntries((list) => (list ?? []).filter((e) => e.id !== p.id));
    };
    const onConnect = () => void load();
    s.on("journal:upsert", onUpsert);
    s.on("journal:remove", onRemove);
    s.on("connect", onConnect);
    return () => {
      s.off("journal:upsert", onUpsert);
      s.off("journal:remove", onRemove);
      s.off("connect", onConnect);
    };
  }, [campaignId, load]);

  const upsertLocal = useCallback((entry: JournalEntry) => setEntries((list) => [...(list ?? []).filter((e) => e.id !== entry.id), entry].sort(order)), []);
  const removeLocal = useCallback((id: string) => setEntries((list) => (list ?? []).filter((e) => e.id !== id)), []);
  return { entries, error, reload: load, upsertLocal, removeLocal };
}

export type Journal = ReturnType<typeof useJournal>;
