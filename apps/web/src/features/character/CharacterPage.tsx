import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { roll as rollDice } from "@vtt/rules";
import { api, errorMessage } from "../../lib/api";
import { emitAck } from "../../lib/socket";
import type { CharacterFull, RollEntry } from "../../lib/types";
import { useAuth } from "../../stores/auth";
import { toast } from "../../stores/toast";
import { Button, Card, ErrorBanner, Loading } from "../../components/ui";
import { RollCard, type RollView } from "../lobby/RollCard";
import { CharacterSheet, type SheetRoll } from "./CharacterSheet";
import { SaveIndicator, SummaryCard, useCharacterDraft } from "./CharacterSheetLoader";

export function CharacterPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const campaignId = params.get("campaign");
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const draft = useCharacterDraft(id);
  const [log, setLog] = useState<RollView[]>([]);
  const c = draft.character;

  const onRoll = async (r: SheetRoll) => {
    try {
      if (campaignId) {
        const res = await emitAck<RollEntry>("dice:roll", { campaignId, formula: r.formula, mode: r.mode, label: r.label, rollType: r.rollType, characterId: id });
        setLog((l) => [{ ...res, who: `${c?.name ?? "?"} (${user.displayName})` }, ...l].slice(0, 30));
      } else {
        const res = rollDice(r.formula, { mode: r.mode });
        setLog((l) =>
          [{ label: r.label, who: c?.name ?? "Local roll", visibility: "public", redacted: false, formula: res.normalized, total: res.total, result: res, createdAt: new Date().toISOString() }, ...l].slice(0, 30),
        );
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (draft.loadError)
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <ErrorBanner message={draft.loadError} onRetry={draft.reload} />
      </div>
    );
  if (!c) return <Loading />;
  if (c.access === "summary")
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <Card>
          <SummaryCard c={c} />
        </Card>
      </div>
    );

  const isOwner = c.access === "owner";
  const exportJson = async () => {
    await draft.flush();
    try {
      const data = await api.get<unknown>(`/api/characters/${c.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${c.name.replace(/[^a-zA-Z0-9_-]+/g, "_") || "character"}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const duplicate = async () => {
    await draft.flush();
    try {
      const { character } = await api.post<{ character: CharacterFull }>(`/api/characters/${c.id}/duplicate`);
      toast.success("Character duplicated");
      navigate(`/characters/${character.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${c.name}? It will be removed from any campaign it's in.`)) return;
    try {
      await api.del(`/api/characters/${c.id}`);
      toast.success("Character deleted");
      navigate("/");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={campaignId ? `/campaigns/${campaignId}` : "/"} className="text-sm text-parchment-400 hover:text-gold-300">
          ← {campaignId ? "Back to lobby" : "Back to dashboard"}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {c.access !== "view" && <SaveIndicator status={draft.status} error={draft.saveError} onRetry={draft.flush} onReload={draft.reload} />}
          {c.access !== "view" && (
            <Button size="sm" onClick={() => draft.flush()} disabled={draft.status === "saved" || draft.status === "saving"} title="Save now (changes also save automatically)">
              Save
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={exportJson}>
            Export JSON
          </Button>
          {isOwner && (
            <>
              <Button size="sm" variant="ghost" onClick={duplicate}>
                Duplicate
              </Button>
              <Button size="sm" variant="ghost" className="text-blood-400" onClick={remove}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card>
          <CharacterSheet character={c} editable={c.access !== "view"} onChange={draft.update} onRoll={onRoll} rollTarget={campaignId ? "campaign" : "local"} />
        </Card>
        <Card title={campaignId ? "Your rolls (sent to table)" : "Roll log (local)"}>
          {log.length === 0 ? (
            <p className="text-sm text-parchment-500">Click any modifier, attack or damage on the sheet to roll.</p>
          ) : (
            <div className="space-y-2">
              {log.map((r, i) => (
                <RollCard key={`${r.createdAt}-${i}`} roll={r} highlight={i === 0} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
