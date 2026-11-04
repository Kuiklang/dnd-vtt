import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatChannel } from "@vtt/rules";
import { Button, Select, Textarea, cx } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { ChatMessage } from "../../lib/types";
import { RollCard } from "./RollCard";
import type { FeedItem, Lobby } from "./useLobby";

const CHANNEL_STYLE: Record<ChatChannel, string> = {
  global: "",
  party: "border-l-2 border-moss-600 pl-2",
  dm: "border-l-2 border-arcane-500 pl-2",
  whisper: "border-l-2 border-gold-600 pl-2 italic",
  system: "",
};

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  global: "Table",
  party: "Party",
  dm: "To DM",
  whisper: "Whisper",
  system: "System",
};

export function Feed({
  lobby,
  myId,
  isGM,
  canWhisper,
  isSpectator,
  members,
  activeCharacterId,
  canModerate,
}: {
  lobby: Lobby;
  myId: string;
  isGM: boolean;
  canWhisper: boolean;
  isSpectator: boolean;
  members: Array<{ userId: string; name: string }>;
  activeCharacterId: string | null;
  canModerate: boolean;
}) {
  const [channel, setChannel] = useState<Exclude<ChatChannel, "system">>("global");
  const [text, setText] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [asCharacter, setAsCharacter] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nameOf = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lobby.feed.length]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      if (editing) {
        await lobby.editMessage(editing.id, content);
        setEditing(null);
      } else if (content.startsWith("/r ") || content.startsWith("/roll ")) {
        // Chat shortcut: "/r 1d20+5 Perception" rolls publicly.
        const [, formula = "", ...labelParts] = content.split(/\s+/);
        await lobby.roll({ formula, label: labelParts.join(" "), visibility: "public", characterId: asCharacter ? activeCharacterId : null });
      } else {
        if (channel === "whisper" && recipients.length === 0) throw new Error("Pick who to whisper to");
        await lobby.sendChat({
          channel,
          content,
          recipientIds: channel === "whisper" ? recipients : [],
          characterId: asCharacter ? activeCharacterId : null,
        });
      }
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape" && editing) {
      setEditing(null);
      setText("");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {lobby.feed.length === 0 && <p className="py-10 text-center text-sm text-parchment-500">No messages yet. Say hello to the table!</p>}
        {lobby.feed.map((item) => (
          <FeedRow
            key={`${item.type}:${item.id}`}
            item={item}
            myId={myId}
            nameOf={nameOf}
            canModerate={canModerate}
            onEdit={(m) => {
              setEditing(m);
              setText(m.content);
            }}
            onDelete={(m) => lobby.deleteMessage(m.id).catch((e) => toast.error(e.message))}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="mt-3 space-y-2 border-t border-ink-700 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="h-8 w-auto text-xs" aria-label="Chat channel">
            <option value="global">Table (everyone)</option>
            {!isSpectator && <option value="party">Party (no spectators)</option>}
            {!isGM && <option value="dm">To the DM</option>}
            {isGM && <option value="dm">DM channel</option>}
            {canWhisper && <option value="whisper">Whisper…</option>}
          </Select>
          {activeCharacterId && (
            <label className="flex items-center gap-1 text-parchment-400">
              <input type="checkbox" className="accent-gold-500" checked={asCharacter} onChange={(e) => setAsCharacter(e.target.checked)} /> Speak in character
            </label>
          )}
          {editing && (
            <span className="text-gold-300">
              Editing message ·{" "}
              <button type="button" className="underline" onClick={() => (setEditing(null), setText(""))}>
                cancel
              </button>
            </span>
          )}
        </div>
        {channel === "whisper" && (
          <div className="flex flex-wrap gap-1">
            {members
              .filter((m) => m.userId !== myId)
              .map((m) => (
                <label key={m.userId} className={cx("cursor-pointer rounded border px-2 py-0.5 text-xs", recipients.includes(m.userId) ? "border-gold-500 text-gold-300" : "border-ink-600 text-parchment-400")}>
                  <input type="checkbox" className="sr-only" checked={recipients.includes(m.userId)} onChange={(e) => setRecipients(e.target.checked ? [...recipients, m.userId] : recipients.filter((r) => r !== m.userId))} />
                  {m.name}
                </label>
              ))}
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Message… (Enter to send, Shift+Enter for a new line, /r 1d20+3 to roll)"
            className="min-h-0 resize-none"
            aria-label="Message"
          />
          <Button type="submit" variant="primary" loading={sending} className="self-end">
            {editing ? "Save" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FeedRow({
  item,
  myId,
  nameOf,
  canModerate,
  onEdit,
  onDelete,
}: {
  item: FeedItem;
  myId: string;
  nameOf: Map<string, string>;
  canModerate: boolean;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
}) {
  if (item.type === "roll") {
    return (
      <RollCard
        roll={{
          label: item.label,
          who: item.characterName ? `${item.characterName} (${item.userName})` : item.userName,
          visibility: item.visibility,
          redacted: item.redacted,
          formula: item.formula,
          total: item.total,
          result: item.result,
          createdAt: item.createdAt,
        }}
      />
    );
  }
  if (item.channel === "system") {
    return <p className="py-1 text-center text-xs text-parchment-500">— {item.content} —</p>;
  }
  const mine = item.senderId === myId;
  return (
    <div className={cx("group text-sm", CHANNEL_STYLE[item.channel])}>
      <div className="flex items-baseline gap-2 text-xs text-parchment-500">
        <span className="font-semibold text-parchment-200">{item.characterName ?? item.senderName ?? "Unknown"}</span>
        {item.characterName && <span>({item.senderName})</span>}
        {item.channel !== "global" && (
          <span className="uppercase tracking-wide">
            {CHANNEL_LABEL[item.channel]}
            {item.channel === "whisper" && ` → ${item.recipientIds.map((id) => nameOf.get(id) ?? "?").join(", ")}`}
          </span>
        )}
        <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        {item.editedAt && !item.deleted && <span>(edited)</span>}
        {!item.deleted && (mine || canModerate) && (
          <span className="ml-auto hidden gap-2 group-hover:flex">
            {mine && (
              <button className="hover:text-gold-300" onClick={() => onEdit(item)}>
                edit
              </button>
            )}
            <button className="hover:text-blood-400" onClick={() => onDelete(item)}>
              delete
            </button>
          </span>
        )}
      </div>
      {item.deleted ? (
        <p className="italic text-parchment-500">Message deleted</p>
      ) : (
        <p className="whitespace-pre-wrap break-words text-parchment-50">{item.content}</p>
      )}
    </div>
  );
}
