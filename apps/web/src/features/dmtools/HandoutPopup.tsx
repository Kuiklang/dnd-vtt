import { useEffect, useState } from "react";
import { Modal } from "../../components/ui";
import { getSocket } from "../../lib/socket";
import { useT } from "../../i18n";
import { Markdown } from "./Markdown";
import type { JournalEntry } from "./types";

/** Shows handouts the DM pushes to this player, one after another. */
export function HandoutPopup({ campaignId }: { campaignId: string }) {
  const t = useT();
  const [queue, setQueue] = useState<JournalEntry[]>([]);
  useEffect(() => {
    const s = getSocket();
    const onShow = (p: { campaignId: string; entry: JournalEntry }) => {
      if (p.campaignId !== campaignId) return;
      setQueue((q) => [...q.filter((e) => e.id !== p.entry.id), p.entry]);
    };
    s.on("handout:show", onShow);
    return () => {
      s.off("handout:show", onShow);
    };
  }, [campaignId]);
  const current = queue[0];
  if (!current) return null;
  return (
    <Modal open onClose={() => setQueue((q) => q.slice(1))} title={`📜 ${current.title}`} wide>
      <div className="space-y-3" data-testid="handout-popup">
        <p className="text-xs text-parchment-500">{t("handout.fromDm")}</p>
        {current.imageUrl && <img src={current.imageUrl} alt={current.title} className="mx-auto max-h-[60vh] rounded border border-ink-700" data-testid="handout-image" />}
        <Markdown text={current.body} />
      </div>
    </Modal>
  );
}
