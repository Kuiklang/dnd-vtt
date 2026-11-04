import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../../lib/api";
import type { CampaignDetail } from "../../lib/types";
import { toast } from "../../stores/toast";
import { Button, ErrorBanner, Modal } from "../../components/ui";
import { CampaignFormFields, type CampaignForm } from "./CampaignFormFields";

export function CampaignSettingsModal({ detail, onClose, onSaved }: { detail: CampaignDetail; onClose: () => void; onSaved: () => void }) {
  const c = detail.campaign;
  const [form, setForm] = useState<CampaignForm>({
    name: c.name,
    description: c.description,
    coverImageUrl: c.coverImageUrl ?? "",
    rulesetId: c.rulesetId,
    setting: c.setting,
    theme: c.theme,
    maxPlayers: c.maxPlayers,
    privacy: c.privacy,
    password: "",
    houseRules: c.houseRules,
  });
  const [removePassword, setRemovePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.rulesetId !== c.rulesetId && !window.confirm("Changing the ruleset affects every calculation in this campaign. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      const { password, ...rest } = form;
      await api.patch(`/api/campaigns/${c.id}`, {
        ...rest,
        coverImageUrl: rest.coverImageUrl || null,
        ...(removePassword ? { password: null } : password ? { password } : {}),
      });
      toast.success("Campaign settings saved");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Campaign settings" wide>
      <form onSubmit={submit} className="space-y-5">
        <CampaignFormFields form={form} onChange={setForm} passwordMode="edit" hasPassword={c.hasPassword} />
        {c.hasPassword && (
          <label className="flex items-center gap-2 text-sm text-parchment-400">
            <input type="checkbox" className="accent-gold-500" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} /> Remove the join password
          </label>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save settings
          </Button>
        </div>
      </form>
    </Modal>
  );
}
