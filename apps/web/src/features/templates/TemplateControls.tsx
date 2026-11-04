import { TEMPLATE_SHAPES } from "@vtt/rules";
import { Button } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { toast } from "../../stores/toast";
import { useT } from "../../i18n";
import type { Table } from "../table/useTable";
import type { TemplateDto } from "../table/types";
import { useTemplateStore } from "./store";

const ICON: Record<TemplateDto["shape"], string> = { circle: "◯", cone: "◸", line: "━", square: "▢" };
const COLORS = ["#e0603a", "#3a8fe0", "#5fbf6a", "#c95fe0", "#e0c33a"];
const small = "h-7 rounded border border-ink-600 bg-ink-850 px-1.5 text-xs text-parchment-100";

/** Inline toolbar controls for the template tool: shape, size (ft), width for lines, colour. */
export function TemplateToolbar({ isGM, hidden, onHidden }: { isGM: boolean; hidden: boolean; onHidden(v: boolean): void }) {
  const t = useT();
  const preset = useTemplateStore((s) => s.preset);
  const setPreset = useTemplateStore((s) => s.setPreset);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="template-toolbar">
      {TEMPLATE_SHAPES.map((s) => (
        <button
          key={s}
          type="button"
          title={t(`template.shape.${s}`)}
          aria-label={t(`template.shape.${s}`)}
          aria-pressed={preset.shape === s}
          data-testid={`template-shape-${s}`}
          onClick={() => setPreset({ shape: s })}
          className={`h-7 w-7 rounded border text-xs ${preset.shape === s ? "border-gold-500 bg-gold-500/20 text-gold-300" : "border-ink-700 text-parchment-200 hover:bg-ink-800"}`}
        >
          {ICON[s]}
        </button>
      ))}
      <label className="flex items-center gap-1 text-xs text-parchment-400">
        {t(preset.shape === "circle" ? "template.radius" : preset.shape === "square" ? "template.side" : "template.length")}
        <input
          type="number"
          min={5}
          max={500}
          step={5}
          value={preset.size}
          onChange={(e) => setPreset({ size: Math.max(5, Math.min(500, Number(e.target.value) || 5)) })}
          className={`${small} w-16`}
          data-testid="template-size"
        />
        ft
      </label>
      {preset.shape === "line" && (
        <label className="flex items-center gap-1 text-xs text-parchment-400">
          {t("template.width")}
          <input type="number" min={5} max={100} step={5} value={preset.width} onChange={(e) => setPreset({ width: Math.max(5, Math.min(100, Number(e.target.value) || 5)) })} className={`${small} w-14`} />
        </label>
      )}
      <div className="flex items-center gap-0.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setPreset({ color: c })}
            className={`h-5 w-5 rounded-full border-2 ${preset.color === c ? "border-parchment-50" : "border-transparent"}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <input
        value={preset.label}
        maxLength={60}
        placeholder={t("template.label")}
        onChange={(e) => setPreset({ label: e.target.value })}
        className={`${small} w-28`}
      />
      {isGM && (
        <label className="flex items-center gap-1 text-xs text-parchment-400">
          <input type="checkbox" checked={hidden} onChange={(e) => onHidden(e.target.checked)} />
          {t("template.hidden")}
        </label>
      )}
    </div>
  );
}

/** Sidebar panel: the selected template's details and delete; "clear all" for the GM. */
export function TemplatePanel({ table, selected, myId, isGM, onDeselect }: { table: Table; selected: TemplateDto | null; myId: string; isGM: boolean; onDeselect(): void }) {
  const t = useT();
  const run = (p: Promise<unknown>) => p.catch((e) => toast.error(errorMessage(e)));
  const canEdit = selected && (isGM || selected.ownerId === myId);
  return (
    <div className="space-y-2 text-sm" data-testid="template-panel">
      {selected ? (
        <>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: selected.color }} />
            <span className="flex-1 truncate">
              {selected.label || t(`template.shape.${selected.shape}`)} · {selected.size} ft
              {selected.shape === "line" ? ` × ${selected.width} ft` : ""}
            </span>
            {selected.hidden && <span className="text-xs text-parchment-500">{t("template.hidden")}</span>}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {selected.shape !== "circle" && (
                <Button size="sm" variant="ghost" onClick={() => run(table.updateTemplate(selected.id, { angle: (selected.angle + 45) % 360 }))}>
                  ⟳ 45°
                </Button>
              )}
              {isGM && (
                <Button size="sm" variant="ghost" onClick={() => run(table.updateTemplate(selected.id, { hidden: !selected.hidden }))}>
                  {selected.hidden ? t("template.reveal") : t("template.hide")}
                </Button>
              )}
              <Button size="sm" variant="danger" data-testid="template-delete" onClick={() => run(table.deleteTemplate(selected.id).then(onDeselect))}>
                {t("template.delete")}
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-parchment-500">{t("template.count", { n: table.templates.length })}</p>
      )}
      {isGM && table.templates.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => window.confirm(t("template.clearConfirm")) && run(table.clearTemplates().then(onDeselect))}>
          {t("template.clear")}
        </Button>
      )}
    </div>
  );
}
