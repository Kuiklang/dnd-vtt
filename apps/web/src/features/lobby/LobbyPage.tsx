import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROLE_LABELS, ROLE_RANK, canManageMember, getBuiltinRuleset, type CampaignRole, type Capability } from "@vtt/rules";
import { api, errorMessage } from "../../lib/api";
import type { CampaignDetail, CharacterFull, PresenceView } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { toast } from "../../stores/toast";
import { Badge, Button, Card, ErrorBanner, Loading, Modal, Select, cx } from "../../components/ui";
import { Avatar } from "../../components/Avatar";
import { useLobby, type Lobby } from "./useLobby";
import { Feed } from "./Feed";
import { DiceTray } from "./DiceTray";
import { InvitePanel } from "./InvitePanel";
import { CampaignSettingsModal } from "./CampaignSettingsModal";
import { CharacterSheetLoader } from "../character/CharacterSheetLoader";

export function LobbyPage() {
  const { id = "" } = useParams();
  const lobby = useLobby(id);
  const { detail, error } = lobby;

  if (error && !detail)
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <ErrorBanner message={error} onRetry={lobby.reloadDetail} />
        <Link to="/" className="mt-4 inline-block text-sm text-gold-400 underline">
          Back to dashboard
        </Link>
      </div>
    );
  if (!detail) return <Loading label="Entering the lobby…" />;
  return <LobbyView lobby={lobby} detail={detail} />;
}

function LobbyView({ lobby, detail }: { lobby: Lobby; detail: CampaignDetail }) {
  const caps = useMemo(() => new Set<Capability>(detail.me.capabilities), [detail.me.capabilities]);
  const isGM = caps.has("dice.seeHidden");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const members = detail.members.map((m) => ({ userId: m.userId, name: m.user.displayName }));
  const presence = new Map(lobby.presence.map((p) => [p.userId, p]));
  const ruleset = getBuiltinRuleset(detail.campaign.rulesetId);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 lg:h-[calc(100vh-3.5rem)]">
      <LobbyHeader lobby={lobby} detail={detail} caps={caps} onSettings={() => setSettingsOpen(true)} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)_340px]">
        <div className="scroll-thin min-h-0 space-y-4 overflow-y-auto">
          <PartyPanel detail={detail} presence={presence} onViewSheet={setSheetId} />
          <MyCharacterPanel lobby={lobby} detail={detail} caps={caps} onViewSheet={setSheetId} />
        </div>
        <Card className="flex min-h-[420px] flex-col lg:min-h-0" bodyClassName="flex min-h-0 flex-1 flex-col" title="Table chat & dice log">
          <div className="h-[60vh] lg:h-auto lg:min-h-0 lg:flex-1">
            <Feed
              lobby={lobby}
              myId={detail.me.userId}
              isGM={isGM}
              canWhisper={caps.has("chat.whisper")}
              isSpectator={detail.me.role === "spectator"}
              members={members}
              activeCharacterId={detail.me.activeCharacterId}
              canModerate={caps.has("chat.moderate")}
            />
          </div>
        </Card>
        <div className="scroll-thin min-h-0 space-y-4 overflow-y-auto">
          {caps.has("dice.roll") ? (
            <Card title="Dice">
              <DiceTray
                onRoll={(req) => lobby.roll({ ...req, characterId: null })}
                canRollHidden={caps.has("dice.rollHidden")}
                members={members}
                myId={detail.me.userId}
              />
            </Card>
          ) : (
            <Card title="Dice">
              <p className="text-sm text-parchment-400">Spectators watch the rolls but can't roll.</p>
            </Card>
          )}
          <Card title="Campaign">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase text-parchment-500">Ruleset</dt>
                <dd>
                  {ruleset?.name ?? detail.campaign.rulesetId}
                  {ruleset && <p className="mt-1 text-[11px] text-parchment-500">{ruleset.attribution}</p>}
                </dd>
              </div>
              {detail.campaign.setting && (
                <div>
                  <dt className="text-xs uppercase text-parchment-500">Setting</dt>
                  <dd>{detail.campaign.setting}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase text-parchment-500">About</dt>
                <dd className="whitespace-pre-wrap text-parchment-400">{detail.campaign.description || "No description."}</dd>
              </div>
              {detail.campaign.houseRules && (
                <div>
                  <dt className="text-xs uppercase text-parchment-500">House rules</dt>
                  <dd className="whitespace-pre-wrap text-parchment-400">{detail.campaign.houseRules}</dd>
                </div>
              )}
              {detail.sessions.length > 0 && (
                <div>
                  <dt className="text-xs uppercase text-parchment-500">Sessions</dt>
                  <dd>
                    <ul className="mt-1 space-y-1">
                      {detail.sessions.map((s) => (
                        <li key={s.id} className="flex justify-between text-xs">
                          <span>{s.name}</span>
                          <span className="text-parchment-500">
                            {s.status === "ended" ? new Date(s.startedAt).toLocaleDateString() : <Badge tone={s.status === "active" ? "green" : "gold"}>{s.status}</Badge>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          {caps.has("members.invite") && <InvitePanel detail={detail} onChanged={lobby.reloadDetail} />}
          <LeaveCampaign detail={detail} />
        </div>
      </div>
      {settingsOpen && <CampaignSettingsModal detail={detail} onClose={() => setSettingsOpen(false)} onSaved={lobby.reloadDetail} />}
      <Modal open={!!sheetId} onClose={() => setSheetId(null)} title="Character sheet" wide>
        {sheetId && (
          <CharacterSheetLoader
            key={`${sheetId}:${lobby.characterTick}`}
            characterId={sheetId}
            onRoll={(req) => lobby.roll({ ...req, characterId: sheetId === detail.me.activeCharacterId ? sheetId : null })}
            rollTarget="campaign"
          />
        )}
      </Modal>
    </div>
  );
}

function LobbyHeader({ lobby, detail, caps, onSettings }: { lobby: Lobby; detail: CampaignDetail; caps: Set<Capability>; onSettings: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const s = detail.activeSession;
  const readyCount = lobby.presence.filter((p) => p.ready && p.status !== "offline").length;
  const players = detail.members.filter((m) => m.role === "player");

  const act = async (action: "start" | "pause" | "end") => {
    if (action === "end" && !window.confirm("End this session? It will be recorded in the campaign history.")) return;
    setBusy(action);
    try {
      await api.post(`/api/campaigns/${detail.campaign.id}/session/${action}`);
      await lobby.reloadDetail();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-850/80 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl text-parchment-50">{detail.campaign.name}</h1>
          <Badge tone="gold">{ROLE_LABELS[detail.me.role]}</Badge>
          {s?.status === "active" && <Badge tone="green">● {s.name} live</Badge>}
          {s?.status === "paused" && <Badge tone="gold">{s.name} paused</Badge>}
          <ConnectionBadge state={lobby.connection} />
        </div>
        <p className="text-xs text-parchment-500">
          {players.length}/{detail.campaign.maxPlayers} players · {readyCount} ready · {detail.campaign.privacy.replace("_", " ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {caps.has("session.control") && (
          <>
            {(!s || s.status === "paused") && (
              <Button variant="primary" loading={busy === "start"} onClick={() => act("start")}>
                {s ? "Resume session" : "Start session"}
              </Button>
            )}
            {s?.status === "active" && (
              <Button loading={busy === "pause"} onClick={() => act("pause")}>
                Pause
              </Button>
            )}
            {s && (
              <Button variant="danger" loading={busy === "end"} onClick={() => act("end")}>
                End session
              </Button>
            )}
          </>
        )}
        {caps.has("campaign.edit") && <Button onClick={onSettings}>Settings</Button>}
      </div>
      {s?.status === "active" && (
        <p className="w-full rounded-md bg-ink-900/70 px-3 py-2 text-xs text-parchment-400">
          The session is live: chat and dice are synced for everyone. The map, tokens and combat table are being built in Phase 2 and are not available yet.
        </p>
      )}
    </div>
  );
}

function ConnectionBadge({ state }: { state: Lobby["connection"] }) {
  if (state === "connected") return <Badge tone="green">Connected</Badge>;
  if (state === "reconnecting") return <Badge tone="red">Reconnecting…</Badge>;
  return <Badge>Connecting…</Badge>;
}

const STATUS_DOT: Record<PresenceView["status"], string> = {
  online: "bg-moss-400",
  reconnecting: "bg-gold-400 animate-pulse",
  offline: "bg-ink-500",
};

function PartyPanel({ detail, presence, onViewSheet }: { detail: CampaignDetail; presence: Map<string, PresenceView>; onViewSheet: (id: string) => void }) {
  const caps = new Set(detail.me.capabilities);
  const sorted = [...detail.members].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role]);
  return (
    <Card title={`Party (${detail.members.length})`}>
      <ul className="space-y-3">
        {sorted.map((m) => {
          const p = presence.get(m.userId);
          const status = p?.status ?? "offline";
          const canView = m.character && (m.character.ownerId === detail.me.userId || caps.has("character.viewAll"));
          return (
            <li key={m.userId} className="flex items-start gap-3">
              <div className="relative">
                <Avatar name={m.character?.name ?? m.user.displayName} url={m.character?.portraitUrl || m.user.avatarUrl} color={m.character?.color} size={36} />
                <span className={cx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-ink-850", STATUS_DOT[status])} title={status} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm text-parchment-50">{m.user.displayName}</span>
                  {m.user.isGuest && <span className="text-[10px] text-parchment-500">guest</span>}
                  <Badge tone={m.role === "player" ? "default" : m.role === "spectator" ? "blue" : "gold"}>{ROLE_LABELS[m.role]}</Badge>
                  {p?.ready && <Badge tone="green">Ready</Badge>}
                </div>
                <p className="truncate text-xs text-parchment-500">
                  {status === "reconnecting" ? "Reconnecting…" : status === "online" ? "Online" : "Offline"}
                  {m.character ? (
                    <>
                      {" · "}
                      {canView ? (
                        <button className="text-gold-400 hover:underline" onClick={() => onViewSheet(m.character!.id)}>
                          {m.character.name}
                        </button>
                      ) : (
                        <span className="text-parchment-200">{m.character.name}</span>
                      )}{" "}
                      {m.character.summary && `(${m.character.summary})`}
                    </>
                  ) : (
                    m.role === "player" && " · no character yet"
                  )}
                </p>
                <MemberActions detail={detail} member={m} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MemberActions({ detail, member }: { detail: CampaignDetail; member: CampaignDetail["members"][number] }) {
  const me = detail.me.role;
  if (member.userId === detail.me.userId || !canManageMember(me, member.role, null)) return null;
  const assignable = (["dm", "co_dm", "player", "spectator"] as CampaignRole[]).filter((r) => r === member.role || canManageMember(me, member.role, r));
  const setRole = async (role: CampaignRole) => {
    try {
      await api.patch(`/api/campaigns/${detail.campaign.id}/members/${member.userId}`, { role });
      toast.success(`${member.user.displayName} is now ${ROLE_LABELS[role]}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const kick = async () => {
    if (!window.confirm(`Remove ${member.user.displayName} from the campaign?`)) return;
    try {
      await api.del(`/api/campaigns/${detail.campaign.id}/members/${member.userId}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="mt-1 flex items-center gap-2">
      <Select className="h-7 w-auto py-0 text-xs" value={member.role} onChange={(e) => setRole(e.target.value as CampaignRole)} aria-label={`Role for ${member.user.displayName}`}>
        {assignable.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <button className="text-xs text-blood-400 hover:underline" onClick={kick}>
        Remove
      </button>
    </div>
  );
}

function MyCharacterPanel({ lobby, detail, caps, onViewSheet }: { lobby: Lobby; detail: CampaignDetail; caps: Set<Capability>; onViewSheet: (id: string) => void }) {
  const library = useAsync(() => api.get<{ characters: CharacterFull[] }>("/api/characters").then((r) => r.characters), []);
  const me = lobby.presence.find((p) => p.userId === detail.me.userId);
  const [saving, setSaving] = useState(false);
  // Optimistic ready toggle; the server's presence broadcast stays the source of truth.
  const [readyOverride, setReadyOverride] = useState<boolean | null>(null);
  const ready = readyOverride ?? me?.ready ?? false;
  const toggleReady = async (value: boolean) => {
    setReadyOverride(value);
    try {
      await lobby.setReady(value);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReadyOverride(null);
    }
  };
  const navigate = useNavigate();
  const eligible = (library.data ?? []).filter((c) => c.kind === "pc" && c.rulesetId === detail.campaign.rulesetId);

  const select = async (characterId: string | null) => {
    setSaving(true);
    try {
      await api.put(`/api/campaigns/${detail.campaign.id}/character`, { characterId });
      await lobby.reloadDetail();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const createNew = async () => {
    const name = window.prompt("Character name");
    if (!name?.trim()) return;
    try {
      const { character } = await api.post<{ character: CharacterFull }>("/api/characters", { name: name.trim(), rulesetId: detail.campaign.rulesetId });
      await api.put(`/api/campaigns/${detail.campaign.id}/character`, { characterId: character.id });
      navigate(`/characters/${character.id}?campaign=${detail.campaign.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card title="You">
      <div className="space-y-3">
        {caps.has("character.selectOwn") ? (
          <>
            <label className="block text-xs uppercase tracking-wider text-parchment-500" htmlFor="char-select">
              Your character
            </label>
            {library.loading ? (
              <Loading />
            ) : (
              <Select id="char-select" value={detail.me.activeCharacterId ?? ""} disabled={saving} onChange={(e) => select(e.target.value || null)}>
                <option value="">— No character —</option>
                {eligible.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            {library.data && eligible.length < library.data.length && (
              <p className="text-[11px] text-parchment-500">Only characters using this campaign's ruleset are listed.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {detail.me.activeCharacterId && (
                <Button size="sm" onClick={() => onViewSheet(detail.me.activeCharacterId!)}>
                  Open sheet
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={createNew}>
                + New character
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-parchment-400">{detail.me.role === "spectator" ? "You're watching as a spectator." : "As a game master you run NPCs and monsters (NPC library arrives in Phase 5)."}</p>
        )}
        <label className="flex items-center justify-between gap-3 rounded-md border border-ink-700 px-3 py-2 text-sm">
          <span>I'm ready to play</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-gold-500"
            checked={ready}
            disabled={lobby.connection !== "connected"}
            onChange={(e) => void toggleReady(e.target.checked)}
          />
        </label>
      </div>
    </Card>
  );
}

function LeaveCampaign({ detail }: { detail: CampaignDetail }) {
  const navigate = useNavigate();
  const isOwner = detail.me.role === "owner";
  const run = async () => {
    const msg = isOwner ? `Delete "${detail.campaign.name}" for everyone? This hides it from all members.` : `Leave "${detail.campaign.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      if (isOwner) await api.del(`/api/campaigns/${detail.campaign.id}`);
      else await api.del(`/api/campaigns/${detail.campaign.id}/members/${detail.me.userId}`);
      toast.success(isOwner ? "Campaign deleted" : "You left the campaign");
      navigate("/");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="px-1 text-right">
      <button className="text-xs text-blood-400 hover:underline" onClick={run}>
        {isOwner ? "Delete campaign" : "Leave campaign"}
      </button>
    </div>
  );
}
