import { useEffect, useRef, useState } from "react";
import { effectiveVolume, seekTarget } from "@vtt/rules";
import { cx } from "../../components/ui";
import { useT } from "../../i18n";
import type { CampaignAudio } from "./useCampaignAudio";
import { positionNow } from "./useCampaignAudio";
import type { AudioView } from "./types";
import { useVolume } from "./volume";

type Music = NonNullable<AudioView["music"]>;

/**
 * Plays whatever the server says is playing, and gives the listener their own
 * volume controls. Mounted once per page (lobby or table).
 */
export function AudioDock({ audio }: { audio: CampaignAudio }) {
  const t = useT();
  const prefs = useVolume();
  const [blocked, setBlocked] = useState(false);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [sfxCount, setSfxCount] = useState(0);
  const onBlocked = (e: unknown) => {
    if (e instanceof DOMException && e.name === "NotAllowedError") setBlocked(true);
  };
  const { view, offsetMs, sfx } = audio;
  const music = view?.music ?? null;

  // One-shot sound effects.
  useEffect(() => {
    if (!sfx) return;
    const el = new Audio(sfx.track.url);
    el.volume = effectiveVolume(sfx.volume, prefs.sfx, prefs.master, prefs.muted);
    if (el.volume === 0) return;
    el.play().then(() => setSfxCount((n) => n + 1), onBlocked);
    // Only the newest event matters; prefs are read at the moment it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sfx]);

  const playingAnything = !!(music?.playing && music.track) || !!view?.ambient.some((a) => a.playing);

  return (
    <div className="relative flex items-center gap-1" data-testid="audio-dock" data-sfx-count={sfxCount}>
      {music?.track && <MusicElement music={music} offsetMs={offsetMs} volume={effectiveVolume(music.volume, prefs.music, prefs.master, prefs.muted)} onBlocked={onBlocked} retry={retry} />}
      {view?.ambient.map((a) => (
        <AmbientElement key={a.id} id={a.id} url={a.track.url} playing={a.playing} volume={effectiveVolume(a.volume, prefs.ambient, prefs.master, prefs.muted)} onBlocked={onBlocked} retry={retry} />
      ))}

      {blocked && playingAnything ? (
        <button
          type="button"
          onClick={() => {
            setBlocked(false);
            setRetry((r) => r + 1);
          }}
          data-testid="audio-unblock"
          className="animate-pulse rounded border border-gold-500 bg-gold-500/20 px-2 py-1 text-xs text-gold-200"
        >
          🔊 {t("audio.enable")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={t("audio.myVolume")}
          aria-label={t("audio.myVolume")}
          aria-expanded={open}
          data-testid="audio-volume-toggle"
          className={cx("flex h-8 items-center gap-1.5 rounded border px-2 text-sm", open ? "border-gold-500 bg-gold-500/20 text-gold-300" : "border-ink-700 text-parchment-200 hover:bg-ink-800")}
        >
          <span>{prefs.muted ? "🔇" : playingAnything ? "🔊" : "🔈"}</span>
          {music?.track && (
            <span className={cx("max-w-40 truncate text-xs", music.playing ? "text-parchment-100" : "text-parchment-500")} data-testid="audio-now-playing">
              {music.track.name}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-10 z-40 w-72 rounded-lg border border-ink-600 bg-ink-900 p-3 shadow-xl" data-testid="audio-volume-panel">
          <p className="mb-2 text-xs text-parchment-400">{t("audio.myVolumeHint")}</p>
          <Slider label={t("audio.master")} value={prefs.master} onChange={(v) => prefs.set({ master: v })} testId="vol-master" />
          <Slider label={t("audio.music")} value={prefs.music} onChange={(v) => prefs.set({ music: v })} testId="vol-music" />
          <Slider label={t("audio.ambient")} value={prefs.ambient} onChange={(v) => prefs.set({ ambient: v })} testId="vol-ambient" />
          <Slider label={t("audio.sfx")} value={prefs.sfx} onChange={(v) => prefs.set({ sfx: v })} testId="vol-sfx" />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prefs.muted} onChange={(e) => prefs.set({ muted: e.target.checked })} data-testid="vol-mute" />
            {t("audio.mute")}
          </label>
          {view && !music?.track && view.ambient.length === 0 && <p className="mt-2 text-xs text-parchment-500">{t("audio.silence")}</p>}
        </div>
      )}
    </div>
  );
}

export function Slider({ label, value, onChange, testId }: { label: string; value: number; onChange(v: number): void; testId?: string }) {
  return (
    <label className="mb-1.5 flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-parchment-300">{label}</span>
      <input type="range" min={0} max={100} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} className="min-w-0 flex-1 accent-gold-500" data-testid={testId} aria-label={label} />
      <span className="w-8 text-right tabular-nums text-parchment-400">{Math.round(value * 100)}</span>
    </label>
  );
}

/** Keeps one <audio> element in step with the server's music clock. */
function MusicElement({ music, offsetMs, volume, onBlocked, retry }: { music: Music; offsetMs: number; volume: number; onBlocked(e: unknown): void; retry: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  const track = music.track!;

  // Declared first so the volume is right before the first play().
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume, track.url]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.loop = music.loop === "track";
    const sync = () => {
      const expected = positionNow(music, offsetMs);
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : track.durationSec;
      // Past the end of a non-looping track: wait for the server to move on rather than restart it.
      const finished = !el.loop && duration !== null && expected >= duration - 0.05;
      if (el.readyState >= 1) {
        const target = seekTarget(expected, el.currentTime, duration, el.loop);
        if (target !== null) el.currentTime = target;
      }
      if (music.playing && !finished) {
        if (el.paused) el.play().catch(onBlocked);
      } else if (!el.paused) el.pause();
    };
    sync();
    el.addEventListener("loadedmetadata", sync);
    const timer = music.playing ? window.setInterval(sync, 4000) : undefined;
    return () => {
      el.removeEventListener("loadedmetadata", sync);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music, offsetMs, track.url, retry]);

  return <audio ref={ref} src={track.url} preload="auto" data-testid="audio-music" data-track={track.id} className="hidden" />;
}

function AmbientElement({ id, url, playing, volume, onBlocked, retry }: { id: string; url: string; playing: boolean; volume: number; onBlocked(e: unknown): void; retry: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = volume;
  }, [volume]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) el.play().catch(onBlocked);
    else el.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, url, retry]);
  return <audio ref={ref} src={url} loop preload="auto" data-testid="audio-ambient" data-layer={id} className="hidden" />;
}
