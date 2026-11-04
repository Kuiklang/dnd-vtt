import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatChannel, RollMode, RollVisibility } from "@vtt/rules";
import { api, errorMessage } from "../../lib/api";
import { emitAck, getSocket } from "../../lib/socket";
import type { CampaignDetail, ChatMessage, PresenceView, RollEntry } from "../../lib/types";
import { toast } from "../../stores/toast";

export type FeedItem = ChatMessage | RollEntry;
export type Connection = "connecting" | "connected" | "reconnecting";

export interface RollRequest {
  formula: string;
  mode?: RollMode;
  visibility?: RollVisibility;
  recipientIds?: string[];
  label?: string;
  rollType?: string;
  characterId?: string | null;
}

/** Merges items by id (later versions replace earlier ones) and keeps them time-ordered. */
function mergeFeed(current: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const map = new Map(current.map((i) => [`${i.type}:${i.id}`, i]));
  for (const i of incoming) map.set(`${i.type}:${i.id}`, i);
  return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-400);
}

export function useLobby(campaignId: string) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceView[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lastRoll, setLastRoll] = useState<RollEntry | null>(null);
  const [characterTick, setCharacterTick] = useState(0);
  const myId = useRef<string | null>(null);

  const reloadDetail = useCallback(async () => {
    try {
      const d = await api.get<CampaignDetail>(`/api/campaigns/${campaignId}`);
      myId.current = d.me.userId;
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [campaignId]);

  useEffect(() => {
    void reloadDetail();
  }, [reloadDetail]);

  useEffect(() => {
    const s = getSocket();
    const join = async () => {
      try {
        const data = await emitAck<{ presence: PresenceView[]; messages: ChatMessage[]; rolls: RollEntry[] }>("campaign:join", { campaignId });
        setPresence(data.presence);
        setFeed((f) => mergeFeed(f, [...data.messages, ...data.rolls]));
        setConnection("connected");
        // Pick up anything that changed while we were away.
        void reloadDetail();
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    const onConnect = () => void join();
    const onDisconnect = () => setConnection("reconnecting");
    const onPresence = (p: { campaignId: string; presence: PresenceView[] }) => p.campaignId === campaignId && setPresence(p.presence);
    const onChat = (m: ChatMessage) => m.campaignId === campaignId && setFeed((f) => mergeFeed(f, [m]));
    const onRoll = (r: RollEntry) => {
      if (r.campaignId !== campaignId) return;
      setFeed((f) => mergeFeed(f, [r]));
      setLastRoll(r);
    };
    const onChanged = (p: { campaignId: string }) => p.campaignId === campaignId && void reloadDetail();
    const onCharacter = (p: { campaignId: string }) => {
      if (p.campaignId !== campaignId) return;
      setCharacterTick((t) => t + 1);
      void reloadDetail();
    };
    const onRemoved = (p: { campaignId: string }) => {
      if (p.campaignId !== campaignId) return;
      toast.info("You're no longer a member of this campaign.");
      navigate("/");
    };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("presence:update", onPresence);
    s.on("chat:message", onChat);
    s.on("dice:roll", onRoll);
    s.on("campaign:changed", onChanged);
    s.on("character:changed", onCharacter);
    s.on("campaign:removed", onRemoved);
    if (s.connected) void join();
    else s.connect();

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("presence:update", onPresence);
      s.off("chat:message", onChat);
      s.off("dice:roll", onRoll);
      s.off("campaign:changed", onChanged);
      s.off("character:changed", onCharacter);
      s.off("campaign:removed", onRemoved);
      if (s.connected) s.emit("campaign:leave", { campaignId });
    };
  }, [campaignId, navigate, reloadDetail]);

  const sendChat = useCallback(
    (input: { channel: Exclude<ChatChannel, "system">; content: string; recipientIds?: string[]; characterId?: string | null }) =>
      emitAck<ChatMessage>("chat:send", { campaignId, recipientIds: [], ...input }),
    [campaignId],
  );
  const editMessage = useCallback((messageId: string, content: string) => emitAck("chat:edit", { campaignId, messageId, content }), [campaignId]);
  const deleteMessage = useCallback((messageId: string) => emitAck("chat:delete", { campaignId, messageId }), [campaignId]);
  const roll = useCallback((req: RollRequest) => emitAck<{ id: string }>("dice:roll", { campaignId, ...req }), [campaignId]);
  const setReady = useCallback((ready: boolean) => emitAck("lobby:ready", { campaignId, ready }), [campaignId]);

  return { detail, error, presence, feed, connection, lastRoll, characterTick, reloadDetail, sendChat, editMessage, deleteMessage, roll, setReady };
}

export type Lobby = ReturnType<typeof useLobby>;
