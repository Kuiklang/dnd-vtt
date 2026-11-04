import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROLE_LABELS, getBuiltinRuleset, type CampaignRole } from "@vtt/rules";
import { api, errorMessage } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Button, Card, ErrorBanner, Field, Input, Loading } from "../components/ui";

interface Preview {
  campaign: {
    id: string;
    name: string;
    description: string;
    coverImageUrl: string | null;
    rulesetId: string;
    setting: string;
    maxPlayers: number;
    players: number;
    ownerName: string;
    requiresPassword: boolean;
    closed: boolean;
  };
  role: CampaignRole;
  exhausted: boolean;
  alreadyMember: CampaignRole | null;
}

export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const preview = useAsync(() => api.get<Preview>(`/api/invitations/${encodeURIComponent(code)}`), [code]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { campaignId } = await api.post<{ campaignId: string }>(`/api/invitations/${encodeURIComponent(code)}/accept`, {
        password: password || undefined,
      });
      navigate(`/campaigns/${campaignId}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (preview.loading) return <Loading />;
  if (preview.error || !preview.data)
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <ErrorBanner message={preview.error ?? "Invitation not found"} />
        <Link to="/" className="mt-4 inline-block text-sm text-gold-400 underline">
          Back to dashboard
        </Link>
      </div>
    );

  const { campaign: c, role, exhausted, alreadyMember } = preview.data;
  const full = role === "player" && c.players >= c.maxPlayers;
  const blocked = c.closed ? "This campaign is closed to new members." : exhausted ? "This invitation has been used up." : full ? "This campaign is full." : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card>
        {c.coverImageUrl && <img src={c.coverImageUrl} alt="" className="-mx-4 -mt-4 mb-4 h-40 w-[calc(100%+2rem)] max-w-none rounded-t-xl object-cover" referrerPolicy="no-referrer" />}
        <p className="text-xs uppercase tracking-widest text-parchment-500">You're invited to</p>
        <h1 className="mt-1 text-2xl text-parchment-50">{c.name}</h1>
        <p className="mt-2 text-sm text-parchment-400">{c.description || "No description."}</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-parchment-500">Dungeon Master</dt>
          <dd>{c.ownerName}</dd>
          <dt className="text-parchment-500">Ruleset</dt>
          <dd>{getBuiltinRuleset(c.rulesetId)?.name ?? c.rulesetId}</dd>
          <dt className="text-parchment-500">Players</dt>
          <dd>
            {c.players} / {c.maxPlayers}
          </dd>
          <dt className="text-parchment-500">You'll join as</dt>
          <dd>{ROLE_LABELS[role]}</dd>
        </dl>
        {alreadyMember ? (
          <Button variant="primary" className="mt-6 w-full" onClick={() => navigate(`/campaigns/${c.id}`)}>
            You're already a member — open lobby
          </Button>
        ) : blocked ? (
          <div className="mt-6">
            <ErrorBanner message={blocked} />
          </div>
        ) : (
          <form onSubmit={accept} className="mt-6 space-y-4">
            {c.requiresPassword && (
              <Field label="Campaign password">
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            {error && <ErrorBanner message={error} />}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Join campaign
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
