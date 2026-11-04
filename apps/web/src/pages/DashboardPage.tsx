import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DEFAULT_RULESET_ID, ROLE_LABELS, getBuiltinRuleset } from "@vtt/rules";
import { api, errorMessage } from "../lib/api";
import type { CharacterFull, DashboardCampaign, PublicCampaign } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../stores/auth";
import { toast } from "../stores/toast";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Loading, Select, cx } from "../components/ui";
import { characterSummary } from "../features/character/format";
import { Avatar } from "../components/Avatar";

type Tab = "active" | "owned" | "joined" | "past" | "public";

export function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const campaigns = useAsync(() => api.get<{ campaigns: DashboardCampaign[] }>("/api/campaigns").then((r) => r.campaigns), []);
  const [tab, setTab] = useState<Tab>("owned");
  const [code, setCode] = useState("");

  const groups = useMemo(() => {
    const list = campaigns.data ?? [];
    return {
      active: list.filter((c) => c.activeSessionId),
      owned: list.filter((c) => c.role === "owner"),
      joined: list.filter((c) => c.role !== "owner"),
      past: list.filter((c) => !c.activeSessionId && c.endedSessions > 0),
    };
  }, [campaigns.data]);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().replace(/^.*\/join\//, "").toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(clean)) return toast.error("Enter a valid invitation code or link");
    navigate(`/join/${clean}`);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl text-parchment-50">Welcome back, {user.displayName}</h1>
          <p className="text-sm text-parchment-400">Your campaigns and characters.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={join} className="flex gap-2">
            <Input placeholder="Invite code or link" value={code} onChange={(e) => setCode(e.target.value)} className="w-52" aria-label="Invitation code" />
            <Button type="submit">Join</Button>
          </form>
          {user.isGuest ? (
            <span title="Guests can't create campaigns">
              <Button variant="primary" disabled>
                + New campaign
              </Button>
            </span>
          ) : (
            <Link to="/campaigns/new">
              <Button variant="primary">+ New campaign</Button>
            </Link>
          )}
        </div>
      </div>
      {user.isGuest && (
        <div className="rounded-md border border-gold-600/40 bg-gold-500/10 px-4 py-3 text-sm text-gold-300">
          You're playing as a guest. Guests can join campaigns and keep up to 5 characters.{" "}
          <Link to="/profile" className="underline">
            Upgrade to a full account
          </Link>{" "}
          to run your own games and keep your data.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card
          title="Campaigns"
          actions={
            <div className="flex flex-wrap gap-1 text-xs" role="tablist">
              {(
                [
                  ["owned", `Created (${groups.owned.length})`],
                  ["joined", `Joined (${groups.joined.length})`],
                  ["active", `Playing now (${groups.active.length})`],
                  ["past", `Played (${groups.past.length})`],
                  ["public", "Browse public"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cx("rounded px-2 py-1", tab === t ? "bg-ink-700 text-gold-300" : "text-parchment-400 hover:text-parchment-200")}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {tab === "public" ? (
            <PublicCampaigns />
          ) : campaigns.loading ? (
            <Loading />
          ) : campaigns.error ? (
            <ErrorBanner message={campaigns.error} onRetry={campaigns.reload} />
          ) : groups[tab].length === 0 ? (
            <EmptyState title={emptyTitle(tab)}>
              {tab === "owned" && !user.isGuest ? "Create a campaign to invite your players." : "Join with an invitation code from your DM."}
            </EmptyState>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {groups[tab].map((c) => (
                <li key={c.id}>
                  <Link to={`/campaigns/${c.id}`} className="block h-full rounded-lg border border-ink-700 bg-ink-900/70 p-4 transition hover:border-gold-600/60">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-lg text-parchment-50">{c.name}</h3>
                      {c.activeSessionId && <Badge tone="green">Live</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-parchment-400">{c.description || "No description."}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-parchment-500">
                      <Badge tone="gold">{ROLE_LABELS[c.role]}</Badge>
                      <span>{getBuiltinRuleset(c.rulesetId)?.name ?? c.rulesetId}</span>
                      <span>· {c.memberCount} members</span>
                      <span>· DM {c.ownerName}</span>
                      {c.lastPlayedAt && <span>· last played {new Date(c.lastPlayedAt).toLocaleDateString()}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <CharacterLibrary />
      </div>
    </div>
  );
}

function emptyTitle(tab: Tab) {
  return { owned: "No campaigns created yet", joined: "You haven't joined any campaigns", active: "Nothing is being played right now", past: "No finished sessions yet", public: "" }[tab];
}

function PublicCampaigns() {
  const navigate = useNavigate();
  const list = useAsync(() => api.get<{ campaigns: PublicCampaign[] }>("/api/campaigns/public").then((r) => r.campaigns), []);
  const [joining, setJoining] = useState<string | null>(null);

  const join = async (c: PublicCampaign) => {
    let password: string | undefined;
    if (c.hasPassword) {
      password = window.prompt(`"${c.name}" needs a password`) ?? undefined;
      if (password === undefined) return;
    }
    setJoining(c.id);
    try {
      await api.post(`/api/campaigns/${c.id}/join`, { password });
      navigate(`/campaigns/${c.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setJoining(null);
    }
  };

  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBanner message={list.error} onRetry={list.reload} />;
  if (!list.data?.length) return <EmptyState title="No public campaigns right now" />;
  return (
    <ul className="divide-y divide-ink-700">
      {list.data.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-parchment-50">{c.name}</p>
            <p className="text-xs text-parchment-500">
              DM {c.ownerName} · {c.players}/{c.maxPlayers} players · {getBuiltinRuleset(c.rulesetId)?.name}
              {c.hasPassword && " · 🔒 password"}
            </p>
          </div>
          {c.isMember ? (
            <Link to={`/campaigns/${c.id}`}>
              <Button size="sm">Open</Button>
            </Link>
          ) : (
            <Button size="sm" variant="primary" disabled={c.players >= c.maxPlayers} loading={joining === c.id} onClick={() => join(c)}>
              {c.players >= c.maxPlayers ? "Full" : "Join"}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function CharacterLibrary() {
  const navigate = useNavigate();
  const lib = useAsync(() => api.get<{ characters: CharacterFull[] }>("/api/characters").then((r) => r.characters), []);
  const [creating, setCreating] = useState(false);
  const [rulesetId, setRulesetId] = useState(DEFAULT_RULESET_ID);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    const name = window.prompt("Character name");
    if (!name?.trim()) return;
    setCreating(true);
    try {
      const { character } = await api.post<{ character: CharacterFull }>("/api/characters", { name: name.trim(), rulesetId });
      navigate(`/characters/${character.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const importFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return toast.error("File is too large (max 2 MB)");
    try {
      const json = JSON.parse(await file.text());
      const { character } = await api.post<{ character: CharacterFull }>("/api/characters/import", { file: json });
      toast.success(`Imported ${character.name}`);
      void lib.reload();
    } catch (e) {
      toast.error(e instanceof SyntaxError ? "That file isn't valid JSON" : errorMessage(e));
    }
  };

  return (
    <Card
      title="Character library"
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Import a character exported as JSON">
            Import JSON
          </Button>
          <Link to="/characters/import" data-testid="import-sheet-link">
            <Button size="sm" variant="ghost" title="Read a character sheet from a PDF or photo">
              Import PDF / photo
            </Button>
          </Link>
        </>
      }
    >
      <div className="mb-4 flex gap-2">
        <Select value={rulesetId} onChange={(e) => setRulesetId(e.target.value)} aria-label="Ruleset for new character">
          <option value="dnd5e-2024">D&amp;D 5e (2024)</option>
          <option value="dnd5e-2014">D&amp;D 5e (2014)</option>
        </Select>
        <Button variant="ghost" onClick={create} loading={creating} className="shrink-0" title="Start from an empty sheet for the selected ruleset">
          + Blank sheet
        </Button>
        <Link to="/characters/new" data-testid="create-guided-link" className="shrink-0">
          <Button variant="primary" title="Step-by-step level 1 character (5e 2014, SRD 5.1)">+ Guided (5e 2014)</Button>
        </Link>
      </div>
      {lib.loading ? (
        <Loading />
      ) : lib.error ? (
        <ErrorBanner message={lib.error} onRetry={lib.reload} />
      ) : !lib.data?.length ? (
        <EmptyState title="No characters yet">Create a character or import one from JSON.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {lib.data.map((c) => (
            <li key={c.id}>
              <Link to={`/characters/${c.id}`} className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900/60 p-3 hover:border-gold-600/60">
                <Avatar name={c.name} url={c.data.portraitUrl} color={c.data.color} />
                <div className="min-w-0">
                  <p className="truncate text-parchment-50">{c.name}</p>
                  <p className="truncate text-xs text-parchment-500">
                    {characterSummary(c.data) || "Unfinished character"} · {c.rulesetId === "dnd5e-2014" ? "5e 2014" : "5e 2024"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
