import { Button, cx } from "../../components/ui";
import { useT } from "../../i18n";
import type { Voice } from "./useVoice";

/** Join/leave voice, mute, and who's talking (with a volume slider per person). */
export function VoicePanel({ voice, myName }: { voice: Voice; myName: string }) {
  const t = useT();
  if (!voice.joined)
    return (
      <div className="space-y-1.5 text-sm" data-testid="voice-panel">
        <Button size="sm" variant="primary" loading={voice.joining} onClick={() => void voice.join()} data-testid="voice-join">
          🎙 {t("voice.join")}
        </Button>
        <p className="text-xs text-parchment-500">{t("voice.hint")}</p>
      </div>
    );
  return (
    <div className="space-y-2 text-sm" data-testid="voice-panel">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={voice.muted ? "danger" : "ghost"} onClick={voice.toggleMute} data-testid="voice-mute">
          {voice.muted ? `🔇 ${t("voice.unmute")}` : `🎙 ${t("voice.mute")}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={voice.leave} data-testid="voice-leave">
          {t("voice.leave")}
        </Button>
      </div>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <Talking on={voice.selfSpeaking && !voice.muted} />
          <span className="flex-1 truncate">
            {myName} <span className="text-xs text-parchment-500">({t("voice.you")})</span>
          </span>
          {voice.muted && <span className="text-xs">🔇</span>}
        </li>
        {voice.peers.map((p) => (
          <li key={p.peerId} className="space-y-0.5" data-testid="voice-peer" data-state={p.state}>
            <div className="flex items-center gap-2">
              <Talking on={p.speaking && !p.muted} />
              <span className="flex-1 truncate">{p.name}</span>
              {p.muted && <span className="text-xs">🔇</span>}
              {p.state !== "connected" && <span className="text-xs text-parchment-500">{t(p.state === "failed" ? "voice.failed" : "voice.connecting")}</span>}
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={p.volume}
              onChange={(e) => voice.setVolume(p.peerId, Number(e.target.value))}
              className="w-full accent-gold-500"
              aria-label={t("voice.volumeFor", { name: p.name })}
            />
          </li>
        ))}
      </ul>
      {voice.peers.length === 0 && <p className="text-xs text-parchment-500">{t("voice.alone")}</p>}
      {voice.peers.some((p) => p.state === "failed") && <p className="text-xs text-blood-400">{t("voice.failedHint")}</p>}
    </div>
  );
}

function Talking({ on }: { on: boolean }) {
  return <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full transition-colors", on ? "bg-moss-400 shadow-[0_0_6px] shadow-moss-400" : "bg-ink-600")} />;
}
