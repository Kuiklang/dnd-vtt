import { useEffect, useState } from "react";
import { Button, Textarea, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { toast } from "../../stores/toast";
import { useLang, useT, type MessageKey } from "../../i18n";
import { Markdown } from "./Markdown";

const MODES = ["describe", "npc", "encounter", "names", "loot", "rules", "ask"] as const;
type Mode = (typeof MODES)[number];

interface Answer {
  mode: Mode;
  prompt: string;
  text: string;
}

/**
 * DM-only AI helper: describes a scene, makes an NPC, suggests an encounter, names, loot,
 * or answers a rules question, using the campaign's setting, party, current map and log.
 * Answers can be copied or saved to the journal (DM-only).
 */
export function AiAssistantPanel({ campaignId }: { campaignId: string }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [status, setStatus] = useState<{ available: boolean; provider: string | null } | null>(null);
  const [mode, setMode] = useState<Mode>("describe");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);

  useEffect(() => {
    api
      .get<{ available: boolean; provider: string | null }>(`/api/campaigns/${campaignId}/ai`)
      .then(setStatus)
      .catch(() => setStatus({ available: false, provider: null }));
  }, [campaignId]);

  const ask = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ text: string }>(`/api/campaigns/${campaignId}/ai/assist`, { mode, prompt, language: lang });
      setAnswers((a) => [{ mode, prompt, text: res.text }, ...a].slice(0, 10));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (a: Answer) => {
    try {
      const title = `${t(`ai.mode.${a.mode}` as MessageKey)}${a.prompt ? `: ${a.prompt}` : ""}`.slice(0, 120);
      await api.post(`/api/campaigns/${campaignId}/journal`, { title, body: a.text, folder: "AI", visibility: "gm" });
      toast.success(t("ai.saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!status) return <p className="text-sm text-parchment-500">{t("common.loading")}</p>;
  if (!status.available)
    return (
      <div className="space-y-2 text-sm" data-testid="ai-panel">
        <p className="font-semibold text-gold-300">{t("ai.offTitle")}</p>
        <p className="text-parchment-300">{t("ai.offBody")}</p>
      </div>
    );

  return (
    <div className="space-y-3 text-sm" data-testid="ai-panel">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("ai.title")}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            data-testid={`ai-mode-${m}`}
            className={cx("rounded-full border px-2.5 py-1 text-xs", mode === m ? "border-gold-500 bg-gold-500/20 text-gold-200" : "border-ink-600 text-parchment-300 hover:bg-ink-800")}
          >
            {t(`ai.mode.${m}` as MessageKey)}
          </button>
        ))}
      </div>
      <Textarea
        value={prompt}
        maxLength={2000}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void ask();
        }}
        placeholder={t(`ai.placeholder.${mode}` as MessageKey)}
        className="min-h-20"
        data-testid="ai-prompt"
      />
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void ask()} data-testid="ai-ask">
          ✨ {t("ai.ask")}
        </Button>
        <span className="text-xs text-parchment-500">{t(status.provider === "claude-code" ? "ai.viaClaudeCode" : "ai.viaApi")}</span>
      </div>
      <p className="text-xs text-parchment-500">{t("ai.contextNote")}</p>
      {answers.map((a, i) => (
        <div key={answers.length - i} className="space-y-2 rounded-md border border-ink-700 bg-ink-850 p-3" data-testid="ai-answer">
          <p className="text-xs uppercase tracking-wider text-gold-400">
            {t(`ai.mode.${a.mode}` as MessageKey)}
            {a.prompt && <span className="normal-case tracking-normal text-parchment-500"> · {a.prompt}</span>}
          </p>
          <Markdown text={a.text} />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(a.text).then(() => toast.success(t("ai.copied")))}>
              {t("ai.copy")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void save(a)} data-testid="ai-save">
              {t("ai.save")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
