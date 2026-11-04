import { useCallback, useEffect, useRef, useState } from "react";
import { emitAck, getSocket } from "../../lib/socket";
import { errorMessage } from "../../lib/api";
import { toast } from "../../stores/toast";

/**
 * Voice chat over WebRTC (Phase 8). Each pair of people at the table gets a direct audio
 * connection; the server only passes connection messages between them. Whoever joins
 * later calls everyone already in the channel, so two sides never call each other at once.
 */

export interface VoicePeerView {
  peerId: string;
  userId: string;
  name: string;
  muted: boolean;
  speaking: boolean;
  state: RTCPeerConnectionState | "new";
  volume: number;
}

interface PeerConn {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
  stopMeter?: () => void;
}

type SignalData = { sdp: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

const VOLUME_KEY = "vtt.voice.volume.";

function storedVolume(userId: string): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY + userId));
    return Number.isFinite(v) && v > 0 ? Math.min(v, 1) : 1;
  } catch {
    return 1;
  }
}

/** Calls `onLevel(speaking)` as a stream's loudness crosses a threshold. */
function meter(ctx: AudioContext, stream: MediaStream, onLevel: (speaking: boolean) => void): () => void {
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let last = false;
  const timer = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    const speaking = Math.sqrt(sum / buf.length) > 0.04;
    if (speaking !== last) onLevel((last = speaking));
  }, 150);
  return () => {
    clearInterval(timer);
    src.disconnect();
  };
}

export function useVoice(campaignId: string, connected: boolean) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [peers, setPeers] = useState<Map<string, VoicePeerView>>(new Map());
  const conns = useRef(new Map<string, PeerConn>());
  const local = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const ice = useRef<RTCIceServer[]>([]);
  const stopSelfMeter = useRef<(() => void) | null>(null);
  const joinedRef = useRef(false);

  const patchPeer = useCallback((peerId: string, p: Partial<VoicePeerView>) => {
    setPeers((m) => {
      const cur = m.get(peerId);
      if (!cur) return m;
      return new Map(m).set(peerId, { ...cur, ...p });
    });
  }, []);

  const send = useCallback((to: string, data: SignalData) => getSocket().emit("voice:signal", { campaignId, to, data }), [campaignId]);

  const closePeer = useCallback((peerId: string) => {
    const c = conns.current.get(peerId);
    if (c) {
      c.stopMeter?.();
      c.pc.close();
      c.audio.srcObject = null;
      conns.current.delete(peerId);
    }
    setPeers((m) => {
      if (!m.has(peerId)) return m;
      const next = new Map(m);
      next.delete(peerId);
      return next;
    });
  }, []);

  /** Creates the connection to one peer; `call` = we send the offer. */
  const connect = useCallback(
    async (peer: { peerId: string; userId: string; name: string; muted: boolean }, call: boolean) => {
      if (conns.current.has(peer.peerId)) return conns.current.get(peer.peerId)!;
      const pc = new RTCPeerConnection({ iceServers: ice.current });
      const audio = new Audio();
      audio.autoplay = true;
      audio.volume = storedVolume(peer.userId);
      const conn: PeerConn = { pc, audio, pendingCandidates: [] };
      conns.current.set(peer.peerId, conn);
      setPeers((m) => new Map(m).set(peer.peerId, { ...peer, speaking: false, state: "new", volume: audio.volume }));
      for (const track of local.current?.getTracks() ?? []) pc.addTrack(track, local.current!);
      pc.onicecandidate = (e) => e.candidate && send(peer.peerId, { candidate: e.candidate.toJSON() });
      pc.onconnectionstatechange = () => patchPeer(peer.peerId, { state: pc.connectionState });
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        audio.srcObject = stream;
        void audio.play().catch(() => {});
        if (audioCtx.current && !conn.stopMeter) conn.stopMeter = meter(audioCtx.current, stream, (speaking) => patchPeer(peer.peerId, { speaking }));
      };
      if (call) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send(peer.peerId, { sdp: pc.localDescription!.toJSON() });
      }
      return conn;
    },
    [send, patchPeer],
  );

  const leave = useCallback(() => {
    for (const id of [...conns.current.keys()]) closePeer(id);
    stopSelfMeter.current?.();
    stopSelfMeter.current = null;
    for (const t of local.current?.getTracks() ?? []) t.stop();
    local.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    if (joinedRef.current) getSocket().emit("voice:leave", { campaignId });
    joinedRef.current = false;
    setJoined(false);
    setMuted(false);
    setSelfSpeaking(false);
    setPeers(new Map());
  }, [campaignId, closePeer]);

  const join = useCallback(async () => {
    if (joinedRef.current || joining) return;
    setJoining(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use a microphone here (voice needs HTTPS or localhost).");
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      audioCtx.current = new AudioContext();
      stopSelfMeter.current = meter(audioCtx.current, local.current, setSelfSpeaking);
      const res = await emitAck<{ peers: VoicePeerView[]; self: string; iceServers: RTCIceServer[] }>("voice:join", { campaignId });
      ice.current = res.iceServers;
      joinedRef.current = true;
      setJoined(true);
      // We're the newcomer: call everyone already here.
      for (const p of res.peers) await connect(p, true);
    } catch (e) {
      for (const t of local.current?.getTracks() ?? []) t.stop();
      local.current = null;
      const msg = e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone permission was denied." : errorMessage(e);
      toast.error(msg);
    } finally {
      setJoining(false);
    }
  }, [campaignId, connect, joining]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    for (const t of local.current?.getAudioTracks() ?? []) t.enabled = !next;
    setMuted(next);
    void emitAck("voice:mute", { campaignId, muted: next }).catch(() => {});
  }, [muted, campaignId]);

  const setVolume = useCallback(
    (peerId: string, volume: number) => {
      const c = conns.current.get(peerId);
      if (c) c.audio.volume = volume;
      const p = peers.get(peerId);
      if (p) {
        try {
          localStorage.setItem(VOLUME_KEY + p.userId, String(volume));
        } catch {
          /* per-browser convenience only */
        }
      }
      patchPeer(peerId, { volume });
    },
    [peers, patchPeer],
  );

  useEffect(() => {
    const s = getSocket();
    const onJoined = (p: { campaignId: string; peer: VoicePeerView }) => {
      if (p.campaignId !== campaignId || !joinedRef.current) return;
      // They will call us; just show them.
      setPeers((m) => new Map(m).set(p.peer.peerId, { ...p.peer, speaking: false, state: "new", volume: storedVolume(p.peer.userId) }));
    };
    const onLeft = (p: { campaignId: string; peerId: string }) => p.campaignId === campaignId && closePeer(p.peerId);
    const onState = (p: { campaignId: string; peerId: string; muted: boolean }) => p.campaignId === campaignId && patchPeer(p.peerId, { muted: p.muted });
    const onSignal = async (p: { campaignId: string; from: string; userId: string; data: SignalData }) => {
      if (p.campaignId !== campaignId || !joinedRef.current) return;
      try {
        if ("sdp" in p.data) {
          const known = peers.get(p.from);
          const conn = conns.current.get(p.from) ?? (await connect({ peerId: p.from, userId: p.userId, name: known?.name ?? "", muted: known?.muted ?? false }, false));
          await conn.pc.setRemoteDescription(p.data.sdp);
          for (const c of conn.pendingCandidates.splice(0)) await conn.pc.addIceCandidate(c);
          if (p.data.sdp.type === "offer") {
            const answer = await conn.pc.createAnswer();
            await conn.pc.setLocalDescription(answer);
            send(p.from, { sdp: conn.pc.localDescription!.toJSON() });
          }
        } else {
          const conn = conns.current.get(p.from);
          if (!conn) return;
          if (conn.pc.remoteDescription) await conn.pc.addIceCandidate(p.data.candidate);
          else conn.pendingCandidates.push(p.data.candidate);
        }
      } catch (e) {
        console.warn("voice signal failed", e);
      }
    };
    s.on("voice:peer-joined", onJoined);
    s.on("voice:peer-left", onLeft);
    s.on("voice:peer-state", onState);
    s.on("voice:signal", onSignal);
    return () => {
      s.off("voice:peer-joined", onJoined);
      s.off("voice:peer-left", onLeft);
      s.off("voice:peer-state", onState);
      s.off("voice:signal", onSignal);
    };
  }, [campaignId, connect, closePeer, patchPeer, send, peers]);

  // A dropped connection loses the voice channel on the server; start clean.
  useEffect(() => {
    if (!connected && joinedRef.current) {
      leave();
      toast.error("Voice chat disconnected. Join again when you're back online.");
    }
  }, [connected, leave]);

  // Leave when the table closes.
  useEffect(() => () => leave(), [leave]);

  return { joined, joining, muted, selfSpeaking, peers: [...peers.values()], join, leave, toggleMute, setVolume };
}

export type Voice = ReturnType<typeof useVoice>;
