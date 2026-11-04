import { useEffect, useRef, useState } from "react";
import { TOKEN_LAYERS, TOKEN_SHAPES, type TokenLayer, type TokenShape } from "@vtt/rules";
import { Button, Field, Input, Select } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { IMAGE_ACCEPT, uploadImage } from "../../lib/upload";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import type { CampaignDetail } from "../../lib/types";
import type { TokenDto } from "./types";
import type { Table } from "./useTable";

interface Props {
  table: Table;
  detail: CampaignDetail;
  isGM: boolean;
  selected: TokenDto | null;
  dropPoint(): { x: number; y: number };
  onSelect(id: string | null): void;
}

/** Add tokens (GM: blank or party character; player: own character) and edit the selection. */
export function TokenPanel({ table, detail, isGM, selected, dropPoint, onSelect }: Props) {
  const t = useT();
  const campaignId = detail.campaign.id;
  const myCharacterId = detail.me.activeCharacterId;
  const myTokenOnMap = myCharacterId ? [...table.tokens.values()].some((tk) => tk.characterId === myCharacterId) : false;
  const party = detail.members.filter((m) => m.character);

  const add = async (input: Partial<TokenDto>) => {
    try {
      const p = dropPoint();
      const tk = await table.createToken({ ...input, x: p.x, y: p.y });
      onSelect(tk.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-3 text-sm">
      {isGM ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => add({ name: "Token" })} data-testid="add-token">
              {t("tokens.blank")}
            </Button>
            {party.length > 0 && (
              <Select
                className="h-8 flex-1 text-sm"
                value=""
                onChange={(e) => {
                  const m = party.find((p) => p.character!.id === e.target.value);
                  if (m?.character) void add({ characterId: m.character.id, ownerIds: [m.userId] });
                }}
                aria-label={t("tokens.addCharacter")}
              >
                <option value="">{t("tokens.addCharacter")}…</option>
                {party.map((m) => (
                  <option key={m.character!.id} value={m.character!.id}>
                    {m.character!.name} ({m.user.displayName})
                  </option>
                ))}
              </Select>
            )}
          </div>
          <p className="text-xs text-parchment-500">{t("tokens.selectHint")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {myCharacterId ? (
            !myTokenOnMap && (
              <>
                <Button size="sm" variant="primary" onClick={() => add({ characterId: myCharacterId })} data-testid="place-my-token">
                  {t("tokens.placeMine")}
                </Button>
                <p className="text-xs text-parchment-500">{t("tokens.placeMineHint")}</p>
              </>
            )
          ) : (
            <p className="text-xs text-parchment-400">{t("tokens.noCharacter")}</p>
          )}
          <p className="text-xs text-parchment-500">{t("tokens.readonly")}</p>
        </div>
      )}
      {selected && isGM && <TokenEditor key={selected.id} token={selected} table={table} detail={detail} campaignId={campaignId} onSelect={onSelect} />}
      {selected && !isGM && (
        <div className="rounded-md border border-ink-700 p-2">
          <p className="font-semibold text-parchment-50">{selected.name}</p>
        </div>
      )}
    </div>
  );
}

function TokenEditor({ token, table, detail, campaignId, onSelect }: { token: TokenDto; table: Table; detail: CampaignDetail; campaignId: string; onSelect(id: string | null): void }) {
  const t = useT();
  const [name, setName] = useState(token.name);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setName(token.name), [token.name]);
  const patch = (p: Partial<TokenDto>) => void table.updateToken(token.id, p);
  const players = detail.members.filter((m) => m.role === "player" || m.role === "spectator" || m.role === "co_dm");

  return (
    <div className="space-y-2 rounded-md border border-ink-700 p-2" data-testid="token-editor">
      <Field label={t("common.name")}>
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== token.name && patch({ name: name.trim() })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("tokens.size")}>
          <Select value={String(token.size)} onChange={(e) => patch({ size: Number(e.target.value) })}>
            {[0.5, 1, 2, 3, 4, 6].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("tokens.layer")}>
          <Select value={token.layer} onChange={(e) => patch({ layer: e.target.value as TokenLayer })}>
            {TOKEN_LAYERS.map((l) => (
              <option key={l} value={l}>
                {t(`tokens.layer.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("tokens.shape")}>
          <Select value={token.shape} onChange={(e) => patch({ shape: e.target.value as TokenShape })}>
            {TOKEN_SHAPES.map((s) => (
              <option key={s} value={s}>
                {t(`tokens.shape.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("tokens.rotation")}>
          <Input type="number" step={15} min={-360} max={360} value={token.rotation} onChange={(e) => patch({ rotation: Number(e.target.value) || 0 })} />
        </Field>
        <Field label={t("tokens.color")}>
          <input type="color" className="h-9 w-full rounded border border-ink-600 bg-ink-900" value={token.color} onChange={(e) => patch({ color: e.target.value })} />
        </Field>
        <Field label={t("tokens.border")}>
          <input type="color" className="h-9 w-full rounded border border-ink-600 bg-ink-900" value={token.borderColor} onChange={(e) => patch({ borderColor: e.target.value })} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ["hidden", t("tokens.hidden")],
            ["locked", t("tokens.locked")],
            ["showName", t("tokens.showName")],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={token[k]} onChange={(e) => patch({ [k]: e.target.checked })} data-testid={`token-${k}`} />
            {label}
          </label>
        ))}
      </div>
      <Field label={t("tokens.owners")}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {players.map((m) => (
            <label key={m.userId} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={token.ownerIds.includes(m.userId)}
                onChange={(e) =>
                  patch({ ownerIds: e.target.checked ? [...token.ownerIds, m.userId] : token.ownerIds.filter((id) => id !== m.userId) })
                }
              />
              {m.user.displayName}
            </label>
          ))}
        </div>
      </Field>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const asset = await uploadImage(f, "token", campaignId);
            patch({ imageAssetId: asset.id });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          {t("tokens.uploadImage")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (!window.confirm(t("tokens.deleteConfirm"))) return;
            table
              .deleteToken(token.id)
              .then(() => onSelect(null))
              .catch((e) => toast.error(errorMessage(e)));
          }}
        >
          {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}
