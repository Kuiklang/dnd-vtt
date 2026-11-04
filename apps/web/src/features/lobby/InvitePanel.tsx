import { useState } from "react";
import { ROLE_LABELS, canManageMember, type CampaignRole } from "@vtt/rules";
import { api, errorMessage } from "../../lib/api";
import type { CampaignDetail } from "../../lib/types";
import { toast } from "../../stores/toast";
import { Button, Card, Select } from "../../components/ui";

export function InvitePanel({ detail, onChanged }: { detail: CampaignDetail; onChanged: () => void }) {
  const [role, setRole] = useState<CampaignRole>("player");
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const roles = (["player", "spectator", "co_dm", "dm"] as CampaignRole[]).filter(
    (r) => r === "player" || r === "spectator" || canManageMember(detail.me.role, "spectator", r),
  );

  const create = async () => {
    setBusy(true);
    try {
      await api.post(`/api/campaigns/${detail.campaign.id}/invitations`, {
        role,
        maxUses: maxUses ? Number(maxUses) : null,
        expiresInHours: expires ? Number(expires) : null,
      });
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.del(`/api/campaigns/${detail.campaign.id}/invitations/${id}`);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't access the clipboard; copy it manually.");
    }
  };

  return (
    <Card title="Invitations">
      {detail.campaign.privacy === "private" && (
        <p className="mb-3 rounded bg-blood-700/20 px-2 py-1 text-xs text-blood-400">The campaign is private (closed): invitations can't be used until you change privacy in Settings.</p>
      )}
      <ul className="space-y-2">
        {detail.invitations.length === 0 && <li className="text-sm text-parchment-500">No active invitations.</li>}
        {detail.invitations.map((inv) => {
          const link = `${window.location.origin}/join/${inv.code}`;
          return (
            <li key={inv.id} className="rounded-md border border-ink-700 bg-ink-900/60 p-2">
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-base tracking-widest text-gold-300">{inv.code}</code>
                <span className="text-xs text-parchment-500">
                  {ROLE_LABELS[inv.role]} · {inv.uses}
                  {inv.maxUses ? `/${inv.maxUses}` : ""} used
                </span>
              </div>
              {inv.expiresAt && <p className="text-[11px] text-parchment-500">Expires {new Date(inv.expiresAt).toLocaleString()}</p>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => copy(link)}>
                  Copy link
                </Button>
                <Button size="sm" variant="ghost" onClick={() => copy(inv.code)}>
                  Copy code
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto text-blood-400" onClick={() => revoke(inv.id)}>
                  Revoke
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 space-y-2 border-t border-ink-700 pt-3">
        <p className="text-xs uppercase tracking-wider text-parchment-500">New invitation</p>
        <div className="grid grid-cols-3 gap-2">
          <Select value={role} onChange={(e) => setRole(e.target.value as CampaignRole)} className="col-span-3" aria-label="Invite role">
            {roles.map((r) => (
              <option key={r} value={r}>
                as {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Select value={maxUses} onChange={(e) => setMaxUses(e.target.value)} aria-label="Maximum uses" className="col-span-1">
            <option value="">∞ uses</option>
            <option value="1">1 use</option>
            <option value="5">5 uses</option>
            <option value="10">10 uses</option>
          </Select>
          <Select value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expiry" className="col-span-2">
            <option value="">Never expires</option>
            <option value="24">Expires in 1 day</option>
            <option value="168">Expires in 7 days</option>
            <option value="720">Expires in 30 days</option>
          </Select>
        </div>
        <Button variant="primary" size="sm" className="w-full" loading={busy} onClick={create}>
          Create invitation
        </Button>
      </div>
    </Card>
  );
}
