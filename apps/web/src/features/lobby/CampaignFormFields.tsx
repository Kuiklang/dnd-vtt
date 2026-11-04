import { BUILTIN_RULESETS } from "@vtt/rules";
import type { Privacy } from "../../lib/types";
import { Field, Input, Select, Textarea } from "../../components/ui";

export interface CampaignForm {
  name: string;
  description: string;
  coverImageUrl: string;
  rulesetId: string;
  setting: string;
  theme: string;
  maxPlayers: number;
  privacy: Privacy;
  password: string;
  houseRules: string;
}

export const PRIVACY_HELP: Record<Privacy, string> = {
  public: "Listed in the public browser; anyone can join (password optional).",
  invite_only: "Hidden; people join with an invitation code or link.",
  private: "Closed table; no new members can join, even with an invite.",
};

export function CampaignFormFields({
  form,
  onChange,
  passwordMode,
  hasPassword,
}: {
  form: CampaignForm;
  onChange: (f: CampaignForm) => void;
  passwordMode: "create" | "edit";
  hasPassword?: boolean;
}) {
  const set = <K extends keyof CampaignForm>(k: K, v: CampaignForm[K]) => onChange({ ...form, [k]: v });
  return (
    <>
      <Field label="Campaign name">
        <Input required maxLength={80} value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea maxLength={4000} value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ruleset" hint="Calculations follow only the selected ruleset.">
          <Select value={form.rulesetId} onChange={(e) => set("rulesetId", e.target.value)}>
            {BUILTIN_RULESETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Setting">
          <Input maxLength={120} placeholder="e.g. Homebrew world, Forgotten Realms…" value={form.setting} onChange={(e) => set("setting", e.target.value)} />
        </Field>
        <Field label="Theme">
          <Select value={form.theme} onChange={(e) => set("theme", e.target.value)}>
            <option value="dark-fantasy">Dark fantasy</option>
            <option value="high-fantasy">High fantasy</option>
            <option value="horror">Horror</option>
            <option value="sci-fantasy">Sci-fantasy</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>
        <Field label="Maximum players">
          <Input type="number" min={1} max={20} value={form.maxPlayers} onChange={(e) => set("maxPlayers", Number(e.target.value))} />
        </Field>
        <Field label="Privacy" hint={PRIVACY_HELP[form.privacy]}>
          <Select value={form.privacy} onChange={(e) => set("privacy", e.target.value as Privacy)}>
            <option value="invite_only">Invite only</option>
            <option value="public">Public</option>
            <option value="private">Private (closed)</option>
          </Select>
        </Field>
        <Field
          label="Join password"
          hint={passwordMode === "edit" ? (hasPassword ? "A password is set. Type a new one to change it." : "No password set.") : "Optional extra protection for joining."}
        >
          <Input type="password" autoComplete="new-password" minLength={4} maxLength={100} value={form.password} onChange={(e) => set("password", e.target.value)} />
        </Field>
      </div>
      <Field label="Cover image URL" hint="https:// link to an image (uploads arrive with the asset storage in Phase 2).">
        <Input type="url" maxLength={500} placeholder="https://…" value={form.coverImageUrl} onChange={(e) => set("coverImageUrl", e.target.value)} />
      </Field>
      <Field label="House rules">
        <Textarea maxLength={10000} value={form.houseRules} onChange={(e) => set("houseRules", e.target.value)} placeholder="Flanking grants advantage, potions are a bonus action…" />
      </Field>
    </>
  );
}
