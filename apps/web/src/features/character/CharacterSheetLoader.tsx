import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterData } from "@vtt/rules";
import { ApiError, api, errorMessage } from "../../lib/api";
import type { CharacterFull, CharacterSummary } from "../../lib/types";
import { Badge, Button, ErrorBanner, Loading } from "../../components/ui";
import { Avatar } from "../../components/Avatar";
import { CharacterSheet, type SheetRoll } from "./CharacterSheet";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "offline" | "conflict";

const AUTOSAVE_MS = 1200;

/**
 * Loads a character and keeps it saved: edits are debounced and sent with the
 * version they were based on; a 409 means someone else saved first.
 */
export function useCharacterDraft(characterId: string) {
  const [character, setCharacter] = useState<CharacterFull | CharacterSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<{ name?: string; data?: CharacterData } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { character: c } = await api.get<{ character: CharacterFull | CharacterSummary }>(`/api/characters/${characterId}`);
      setCharacter(c);
      if (c.access !== "summary") versionRef.current = c.version;
      setStatus("saved");
      setSaveError(null);
      pending.current = null;
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inflight.current) await inflight.current;
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    setStatus("saving");
    const run = (async () => {
      try {
        const { character: saved } = await api.put<{ character: CharacterFull }>(`/api/characters/${characterId}`, {
          expectedVersion: versionRef.current,
          ...patch,
        });
        versionRef.current = saved.version;
        setCharacter((c) => (c && c.access !== "summary" ? { ...c, version: saved.version, updatedAt: saved.updatedAt } : c));
        if (!pending.current) setStatus("saved");
        setSaveError(null);
      } catch (e) {
        // Keep the unsaved edits so nothing is lost.
        pending.current = { ...patch, ...pending.current };
        if (e instanceof ApiError && e.status === 409) setStatus("conflict");
        else if (e instanceof ApiError && e.status === 0) setStatus("offline");
        else setStatus("error");
        setSaveError(errorMessage(e));
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
  }, [characterId]);

  const update = useCallback(
    (patch: { name?: string; data?: CharacterData }) => {
      setCharacter((c) => (c && c.access !== "summary" ? { ...c, ...patch } : c));
      pending.current = { ...pending.current, ...patch };
      setStatus((s) => (s === "conflict" ? s : "unsaved"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  // Save on unmount / tab close so edits aren't lost.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (pending.current) void flush();
    };
  }, [flush]);

  return { character, loadError, status, saveError, update, flush, reload: load };
}

export function SaveIndicator({ status, error, onRetry, onReload }: { status: SaveStatus; error: string | null; onRetry: () => void; onReload: () => void }) {
  switch (status) {
    case "saved":
      return <Badge tone="green">Saved</Badge>;
    case "saving":
      return <Badge tone="blue">Saving…</Badge>;
    case "unsaved":
      return <Badge tone="gold">Unsaved changes</Badge>;
    case "offline":
    case "error":
      return (
        <span className="flex items-center gap-2">
          <Badge tone="red">{status === "offline" ? "Offline" : "Save error"}</Badge>
          <span className="text-xs text-blood-400">{error}</span>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </span>
      );
    case "conflict":
      return (
        <span className="flex items-center gap-2">
          <Badge tone="red">Changed elsewhere</Badge>
          <Button size="sm" onClick={onReload} title="Discard your unsaved edits and load the latest version">
            Load latest
          </Button>
        </span>
      );
  }
}

/** Standalone loader used in the lobby modal. */
export function CharacterSheetLoader({ characterId, onRoll, rollTarget }: { characterId: string; onRoll: (r: SheetRoll) => Promise<unknown>; rollTarget: "campaign" | "local" }) {
  const draft = useCharacterDraft(characterId);
  const c = draft.character;
  if (draft.loadError) return <ErrorBanner message={draft.loadError} onRetry={draft.reload} />;
  if (!c) return <Loading />;
  if (c.access === "summary") return <SummaryCard c={c} />;
  return (
    <div className="space-y-3">
      {c.access !== "view" && (
        <div className="flex justify-end">
          <SaveIndicator status={draft.status} error={draft.saveError} onRetry={draft.flush} onReload={draft.reload} />
        </div>
      )}
      <CharacterSheet character={c} editable={c.access !== "view"} onChange={draft.update} onRoll={onRoll} rollTarget={rollTarget} />
    </div>
  );
}

export function SummaryCard({ c }: { c: CharacterSummary }) {
  return (
    <div className="flex items-center gap-4">
      <Avatar name={c.name} url={c.portraitUrl} color={c.color} size={64} />
      <div>
        <p className="font-display text-xl text-parchment-50">{c.name}</p>
        <p className="text-sm text-parchment-400">{c.summary || "Adventurer"}</p>
        <p className="mt-2 text-xs text-parchment-500">Only the owner and the DM can see the full sheet.</p>
      </div>
    </div>
  );
}
