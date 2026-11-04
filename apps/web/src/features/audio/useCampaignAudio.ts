import { useCallback, useEffect, useRef, useState } from "react";
import { emitAck, getSocket } from "../../lib/socket";
import type { AudioView, ControlAction, PlayableTrack } from "./types";

export interface SfxEvent {
  key: number;
  track: PlayableTrack;
  volume: number;
}

/**
 * Follows the campaign's playback state. `offsetMs` converts local time to server
 * time (serverNow - Date.now() at receipt), so positions match on every client.
 */
export function useCampaignAudio(campaignId: string) {
  const [view, setView] = useState<AudioView | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [sfx, setSfx] = useState<SfxEvent | null>(null);
  const revision = useRef(-1);
  const sfxKey = useRef(0);

  const accept = useCallback((v: AudioView) => {
    // Broadcasts and acks can arrive out of order; never step back.
    if (v.revision < revision.current) return;
    revision.current = v.revision;
    setOffsetMs(v.serverNow - Date.now());
    setView(v);
  }, []);

  useEffect(() => {
    const s = getSocket();
    revision.current = -1;
    const sync = () => void emitAck<AudioView>("audio:sync", { campaignId }).then(accept, () => {});
    const onState = (p: { campaignId: string; audio: AudioView }) => p.campaignId === campaignId && accept(p.audio);
    const onSfx = (p: { campaignId: string; track: PlayableTrack; volume: number }) => {
      if (p.campaignId === campaignId) setSfx({ key: ++sfxKey.current, track: p.track, volume: p.volume });
    };
    s.on("connect", sync);
    s.on("audio:state", onState);
    s.on("audio:sfx", onSfx);
    if (s.connected) sync();
    return () => {
      s.off("connect", sync);
      s.off("audio:state", onState);
      s.off("audio:sfx", onSfx);
    };
  }, [campaignId, accept]);

  const control = useCallback(
    async (action: ControlAction) => accept(await emitAck<AudioView>("audio:control", { campaignId, action })),
    [campaignId, accept],
  );
  const playSfx = useCallback((trackId: string, volume = 1) => emitAck("audio:sfx", { campaignId, trackId, volume }), [campaignId]);

  return { view, offsetMs, sfx, control, playSfx };
}

export type CampaignAudio = ReturnType<typeof useCampaignAudio>;

/** Current music position (seconds) in server time. */
export function positionNow(music: NonNullable<AudioView["music"]>, offsetMs: number, now = Date.now()): number {
  return Math.max(0, music.offsetSec + (music.playing ? (now + offsetMs - music.at) / 1000 : 0));
}

export const formatTime = (sec: number | null | undefined) => {
  if (sec == null || !Number.isFinite(sec)) return "--:--";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
