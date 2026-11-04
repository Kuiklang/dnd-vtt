import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_RULESET_ID } from "@vtt/rules";
import { api, errorMessage } from "../lib/api";
import type { Privacy } from "../lib/types";
import { toast } from "../stores/toast";
import { Button, Card, ErrorBanner } from "../components/ui";
import { CampaignFormFields, type CampaignForm } from "../features/lobby/CampaignFormFields";

export function CreateCampaignPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<CampaignForm>({
    name: "",
    description: "",
    coverImageUrl: "",
    rulesetId: DEFAULT_RULESET_ID,
    setting: "",
    theme: "dark-fantasy",
    maxPlayers: 5,
    privacy: "invite_only" as Privacy,
    password: "",
    houseRules: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { campaign } = await api.post<{ campaign: { id: string } }>("/api/campaigns", {
        ...form,
        coverImageUrl: form.coverImageUrl || null,
        password: form.password || null,
      });
      toast.success("Campaign created");
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-3xl text-parchment-50">New campaign</h1>
      <Card>
        <form onSubmit={submit} className="space-y-5">
          <CampaignFormFields form={form} onChange={setForm} passwordMode="create" />
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create campaign
            </Button>
          </div>
        </form>
      </Card>
      <p className="mt-4 text-xs text-parchment-500">
        Default map and default music are configured once the Map (Phase 2) and Music (Phase 6) systems are available.
      </p>
    </div>
  );
}
