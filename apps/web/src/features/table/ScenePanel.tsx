import { useRef, useState } from "react";
import { GRID_TYPES, type GridSettings } from "@vtt/rules";
import { Badge, Button, Field, Input, Select, Textarea, cx } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { IMAGE_ACCEPT, uploadImage } from "../../lib/upload";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import type { Table } from "./useTable";
import type { SceneDto } from "./types";

/** DM-only: list, create, activate and configure maps. */
export function ScenePanel({ table, campaignId }: { table: Table; campaignId: string }) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const createFromFile = async (file: File) => {
    setCreating(true);
    try {
      const asset = await uploadImage(file, "map", campaignId);
      await table.createScene({ name: name.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Map", backgroundAssetId: asset.id });
      setName("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreating(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const createBlank = async () => {
    setCreating(true);
    try {
      await table.createScene({ name: name.trim() || "Blank map" });
      setName("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-1" data-testid="scene-list">
        {(table.scenes ?? []).map((s) => (
          <li key={s.id}>
            <div
              className={cx(
                "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
                s.id === table.sceneId ? "border-gold-600 bg-ink-800" : "border-transparent hover:bg-ink-800/60",
              )}
            >
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => table.setSceneId(s.id)} title={t("table.viewing")}>
                {s.name}
              </button>
              {s.isActive ? (
                <Badge tone="green">{t("table.activeBadge")}</Badge>
              ) : (
                <button className="text-xs text-gold-400 hover:underline" onClick={() => act(() => table.activateScene(s.id))}>
                  {t("table.activate")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {table.scenes?.length === 0 && <p className="text-sm text-parchment-400">{t("table.noScenesGM")}</p>}
      <div className="space-y-2 rounded-md border border-ink-700 p-2">
        <Input placeholder={t("table.sceneName")} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          data-testid="map-upload"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void createFromFile(f);
          }}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="primary" loading={creating} onClick={() => fileRef.current?.click()} className="flex-1">
            {t("table.uploadMap")}
          </Button>
          <Button size="sm" disabled={creating} onClick={createBlank}>
            {t("table.blankMap")}
          </Button>
        </div>
      </div>
      {table.scene && <SceneSettings key={table.scene.id + table.scene.version} scene={table.scene} table={table} campaignId={campaignId} />}
    </div>
  );
}

function SceneSettings({ scene, table, campaignId }: { scene: SceneDto; table: Table; campaignId: string }) {
  const t = useT();
  const [grid, setGrid] = useState<GridSettings>(scene.grid);
  const [name, setName] = useState(scene.name);
  const [notes, setNotes] = useState(scene.dmNotes ?? "");
  const [w, setW] = useState(scene.width);
  const [h, setH] = useState(scene.height);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty =
    JSON.stringify(grid) !== JSON.stringify(scene.grid) || name !== scene.name || notes !== (scene.dmNotes ?? "") || w !== scene.width || h !== scene.height;

  const save = async () => {
    setBusy(true);
    try {
      await table.updateScene(scene.id, { name: name.trim(), grid, dmNotes: notes, width: w, height: h, expectedVersion: scene.version });
      toast.success(t("save.saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);

  return (
    <details className="rounded-md border border-ink-700 p-2" open>
      <summary className="cursor-pointer text-sm font-semibold text-parchment-200">{t("table.settings")}</summary>
      <div className="mt-2 space-y-2 text-sm">
        <Field label={t("table.sceneName")}>
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("table.gridType")}>
            <Select value={grid.type} onChange={(e) => setGrid({ ...grid, type: e.target.value as GridSettings["type"] })} data-testid="grid-type">
              {GRID_TYPES.map((g) => (
                <option key={g} value={g}>
                  {t(`table.grid.${g}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("table.gridSize")}>
            <Input type="number" min={10} max={500} value={grid.size} onChange={(e) => setGrid({ ...grid, size: num(e.target.value, grid.size) })} />
          </Field>
          <Field label={t("table.gridOffsetX")}>
            <Input type="number" value={grid.offsetX} onChange={(e) => setGrid({ ...grid, offsetX: num(e.target.value, 0) })} />
          </Field>
          <Field label={t("table.gridOffsetY")}>
            <Input type="number" value={grid.offsetY} onChange={(e) => setGrid({ ...grid, offsetY: num(e.target.value, 0) })} />
          </Field>
          <Field label={t("table.unitsPerCell")}>
            <Input type="number" min={0.1} value={grid.unitsPerCell} onChange={(e) => setGrid({ ...grid, unitsPerCell: num(e.target.value, grid.unitsPerCell) })} />
          </Field>
          <Field label={t("table.unit")}>
            <Input value={grid.unit} maxLength={12} onChange={(e) => setGrid({ ...grid, unit: e.target.value })} />
          </Field>
          <Field label={t("table.gridColor")}>
            <input type="color" className="h-10 w-full rounded border border-ink-600 bg-ink-900" value={grid.color} onChange={(e) => setGrid({ ...grid, color: e.target.value })} />
          </Field>
          <Field label={t("table.gridOpacity")}>
            <input type="range" min={0} max={1} step={0.05} className="mt-3 w-full" value={grid.opacity} onChange={(e) => setGrid({ ...grid, opacity: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label={t("table.mapSize")}>
          <div className="flex items-center gap-2">
            <Input type="number" value={w} onChange={(e) => setW(num(e.target.value, w))} />
            <span>×</span>
            <Input type="number" value={h} onChange={(e) => setH(num(e.target.value, h))} />
          </div>
        </Field>
        <Field label={t("table.dmNotes")}>
          <Textarea value={notes} maxLength={20000} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
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
              const asset = await uploadImage(f, "map", campaignId);
              await table.updateScene(scene.id, { backgroundAssetId: asset.id, width: asset.width ?? scene.width, height: asset.height ?? scene.height });
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={save}>
            {t("common.save")}
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            {t("table.replaceBackground")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => table.duplicateScene(scene.id).catch((e) => toast.error(errorMessage(e)))}>
            {t("table.duplicate")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (window.confirm(t("table.deleteSceneConfirm"))) table.deleteScene(scene.id).catch((e) => toast.error(errorMessage(e)));
            }}
          >
            {t("common.delete")}
          </Button>
        </div>
      </div>
    </details>
  );
}
