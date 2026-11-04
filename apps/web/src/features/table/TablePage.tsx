import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { getBuiltinRuleset, type Capability, type FogShape } from "@vtt/rules";
import { Badge, Button, ErrorBanner, Loading, cx } from "../../components/ui";
import { Avatar } from "../../components/Avatar";
import { errorMessage } from "../../lib/api";
import type { CampaignDetail } from "../../lib/types";
import { toast } from "../../stores/toast";
import { useT, type MessageKey } from "../../i18n";
import { useLobby, type Lobby } from "../lobby/useLobby";
import { Feed } from "../lobby/Feed";
import { DiceTray } from "../lobby/DiceTray";
import { MapCanvas, type MapCanvasHandle } from "./canvas/MapCanvas";
import { ScenePanel } from "./ScenePanel";
import { TokenPanel } from "./TokenPanel";
import { useTable, type SaveStatus, type Table } from "./useTable";
import { useCombat } from "./useCombat";
import { CombatPanel } from "./CombatPanel";
import { DiceOverlay } from "../dice/DiceOverlay";
import type { FogShapeKind, Tool } from "./types";

export function TablePage() {
  const { id = "" } = useParams();
  const lobby = useLobby(id);
  const t = useT();
  if (lobby.error && !lobby.detail)
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <ErrorBanner message={lobby.error} onRetry={lobby.reloadDetail} />
      </div>
    );
  if (!lobby.detail) return <Loading label={t("table.loading")} />;
  return <TableView lobby={lobby} detail={lobby.detail} />;
}

/** Ignore shortcuts while the user is typing. */
const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

function TableView({ lobby, detail }: { lobby: Lobby; detail: CampaignDetail }) {
  const t = useT();
  const caps = useMemo(() => new Set<Capability>(detail.me.capabilities), [detail.me.capabilities]);
  const isGM = caps.has("map.manage");
  const table = useTable(detail.campaign.id, isGM, lobby.connection === "connected");
  const combat = useCombat(detail.campaign.id, lobby.connection === "connected");
  const canvasRef = useRef<MapCanvasHandle>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [fogShape, setFogShape] = useState<FogShapeKind>("rect");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // On phones the map gets the whole screen; panels open as overlays on demand.
  const wide = typeof window === "undefined" || window.innerWidth >= 768;
  const [leftOpen, setLeftOpen] = useState(wide);
  const [rightOpen, setRightOpen] = useState(wide);
  const ruleset = getBuiltinRuleset(detail.campaign.rulesetId);
  const diagonal = ruleset?.movement.diagonal ?? "uniform";
  const selected = selectedId ? (table.tokens.get(selectedId) ?? null) : null;
  const tokens = useMemo(() => [...table.tokens.values()], [table.tokens]);
  const activeTokenId = useMemo(() => {
    const c = combat.combat;
    return c?.combatants.find((x) => x.id === c.activeCombatantId)?.tokenId ?? null;
  }, [combat.combat]);
  const defeatedIds = useMemo(
    () => new Set((combat.combat?.combatants ?? []).filter((x) => x.defeated && x.tokenId).map((x) => x.tokenId!)),
    [combat.combat],
  );
  const members = detail.members.map((m) => ({ userId: m.userId, name: m.user.displayName }));
  const presence = new Map(lobby.presence.map((p) => [p.userId, p]));

  useEffect(() => {
    if (selectedId && !table.tokens.has(selectedId)) setSelectedId(null);
  }, [selectedId, table.tokens]);

  const deleteSelected = useCallback(() => {
    if (!selected || !isGM) return;
    if (!window.confirm(t("tokens.deleteConfirm"))) return;
    table.deleteToken(selected.id).then(() => setSelectedId(null), (e) => toast.error(errorMessage(e)));
  }, [selected, isGM, table, t]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "v") setTool("select");
        else if (k === "r") setTool("measure");
        else if (k === "f" && caps.has("fog.manage")) setTool("fog-reveal");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [deleteSelected, caps]);

  const onFogShape = useCallback(
    (mode: "reveal" | "hide", shape: FogShape) => {
      table.addFog(mode, shape).catch((e) => toast.error(errorMessage(e)));
    },
    [table],
  );
  const onMoveToken = useCallback((id: string, x: number, y: number) => void table.updateToken(id, { x, y }), [table]);
  const dropPoint = useCallback(() => {
    const c = canvasRef.current?.viewCenter() ?? { x: 100, y: 100 };
    const s = table.scene;
    if (!s) return c;
    const clamp = (p: { x: number; y: number }) => ({ x: Math.min(Math.max(p.x, 0), s.width), y: Math.min(Math.max(p.y, 0), s.height) });
    // Don't stack a new token on top of an existing one: walk outwards cell by cell to a free spot.
    const step = s.grid.size;
    const taken = (p: { x: number; y: number }) => [...table.tokens.values()].some((tk) => Math.hypot(tk.x - p.x, tk.y - p.y) < step * 0.5);
    for (let ring = 0; ring < 6; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const p = clamp({ x: c.x + dx * step, y: c.y + dy * step });
          if (!taken(p)) return p;
        }
      }
    }
    return clamp(c);
  }, [table.scene, table.tokens]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <DiceOverlay roll={lobby.lastRoll} />
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-900/90 px-3 py-1.5 text-sm">
        <Link to={`/campaigns/${detail.campaign.id}`} className="rounded px-2 py-1 text-parchment-400 hover:bg-ink-800">
          ← {t("table.backToLobby")}
        </Link>
        <span className="truncate font-display text-gold-400">{detail.campaign.name}</span>
        {table.scene && <span className="truncate text-parchment-400">/ {table.scene.name}</span>}
        {isGM && table.scene && !table.scene.isActive && <Badge tone="gold">{t("table.gmViewingOther")}</Badge>}
        <div className="mx-2 h-5 w-px bg-ink-700" />
        <ToolButton active={tool === "select"} onClick={() => setTool("select")} label={t("tool.select")} icon="↖" />
        <ToolButton active={tool === "pan"} onClick={() => setTool("pan")} label={t("tool.pan")} icon="✋" />
        <ToolButton active={tool === "measure"} onClick={() => setTool("measure")} label={t("tool.measure")} icon="📏" testId="tool-measure" />
        {caps.has("fog.manage") && table.scene && (
          <>
            <ToolButton active={tool === "fog-reveal"} onClick={() => setTool("fog-reveal")} label={t("tool.fogReveal")} icon="☀" testId="tool-fog-reveal" />
            <ToolButton active={tool === "fog-hide"} onClick={() => setTool("fog-hide")} label={t("tool.fogHide")} icon="☁" testId="tool-fog-hide" />
            {(tool === "fog-reveal" || tool === "fog-hide") &&
              (["rect", "circle", "polygon"] as const).map((s) => (
                <ToolButton key={s} active={fogShape === s} onClick={() => setFogShape(s)} label={t(`tool.shape.${s}`)} icon={s === "rect" ? "▭" : s === "circle" ? "◯" : "⬠"} small />
              ))}
          </>
        )}
        <ToolButton active={false} onClick={() => canvasRef.current?.fit()} label={t("tool.fit")} icon="⤢" />
        <div className="ml-auto flex items-center gap-3">
          <SaveIndicator status={table.save} offline={lobby.connection !== "connected"} />
          <ConnectionDot connection={lobby.connection} />
        </div>
      </div>
      {tool === "measure" && <Hint>{t("measure.hint")}</Hint>}

      <div className="relative flex min-h-0 flex-1">
        {/* Left sidebar */}
        <Sidebar open={leftOpen} onToggle={() => { setLeftOpen((o) => !o); if (!wide) setRightOpen(false); }} side="left">
          {isGM && (
            <Section title={t("table.scenes")}>
              <ScenePanel table={table} campaignId={detail.campaign.id} />
            </Section>
          )}
          <Section title={t("players.title")}>
            <ul className="space-y-1.5 text-sm">
              {detail.members.map((m) => {
                const p = presence.get(m.userId);
                return (
                  <li key={m.userId} className="flex items-center gap-2">
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", p?.status === "online" ? "bg-moss-400" : p?.status === "reconnecting" ? "bg-gold-400" : "bg-ink-500")} />
                    <Avatar url={m.user.avatarUrl} name={m.user.displayName} size={22} />
                    <span className="min-w-0 flex-1 truncate">{m.character?.name ?? m.user.displayName}</span>
                    {(m.role === "owner" || m.role === "dm" || m.role === "co_dm") && <Badge tone="blue">DM</Badge>}
                  </li>
                );
              })}
            </ul>
          </Section>
        </Sidebar>

        {/* Map */}
        <div className="relative min-w-0 flex-1 bg-[#0e0c0a]">
          {table.error && (
            <div className="absolute inset-x-0 top-4 z-10 mx-auto max-w-md">
              <ErrorBanner message={table.error} onRetry={table.loadScenes} />
            </div>
          )}
          {table.scenes === null ? (
            <Loading label={t("table.loading")} />
          ) : !table.scene ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-parchment-400">
              <p className="max-w-sm">{isGM ? t("table.noScenesGM") : t("table.noScenePlayer")}</p>
            </div>
          ) : (
            <MapCanvas
              ref={canvasRef}
              scene={table.scene}
              tokens={tokens}
              fog={table.fog}
              myId={detail.me.userId}
              isGM={isGM}
              tool={tool}
              fogShape={fogShape}
              spaceHeld={spaceHeld}
              diagonal={diagonal}
              selectedId={selectedId}
              activeTokenId={activeTokenId}
              defeatedIds={defeatedIds}
              onSelect={setSelectedId}
              onMoveToken={onMoveToken}
              onFogShape={onFogShape}
            />
          )}
        </div>

        {/* Right sidebar */}
        <Sidebar open={rightOpen} onToggle={() => { setRightOpen((o) => !o); if (!wide) setLeftOpen(false); }} side="right">
          {(combat.combat || (isGM && table.scene)) && (
            <Section title={t("combat.title")}>
              <CombatPanel
                combat={combat}
                sceneId={table.sceneId}
                tokens={tokens}
                myId={detail.me.userId}
                isGM={caps.has("combat.manage")}
                selectedId={selectedId}
                onSelectToken={setSelectedId}
              />
            </Section>
          )}
          {table.scene && (
            <Section title={t("tokens.title")}>
              <TokenPanel table={table} detail={detail} isGM={isGM} selected={selected} combat={combat} ruleset={ruleset} characterTick={lobby.characterTick} onRoll={lobby.roll} dropPoint={dropPoint} onSelect={setSelectedId} />
            </Section>
          )}
          {caps.has("fog.manage") && table.scene && <FogPanel table={table} />}
          {caps.has("dice.roll") && (
            <Section title="Dice">
              <DiceTray onRoll={(req) => lobby.roll({ ...req, characterId: null })} canRollHidden={caps.has("dice.rollHidden")} members={members} myId={detail.me.userId} />
            </Section>
          )}
          <Section title={t("chat.title")} grow>
            <div className="h-[420px]">
              <Feed
                lobby={lobby}
                myId={detail.me.userId}
                isGM={caps.has("dice.seeHidden")}
                canWhisper={caps.has("chat.whisper")}
                isSpectator={detail.me.role === "spectator"}
                members={members}
                activeCharacterId={detail.me.activeCharacterId}
                canModerate={caps.has("chat.moderate")}
              />
            </div>
          </Section>
        </Sidebar>
      </div>
    </div>
  );
}

function FogPanel({ table }: { table: Table }) {
  const t = useT();
  const scene = table.scene!;
  const run = (p: Promise<unknown>) => p.catch((e) => toast.error(errorMessage(e)));
  return (
    <Section title={t("fog.title")}>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scene.fogEnabled} onChange={(e) => run(table.setFogEnabled(e.target.checked))} data-testid="fog-enabled" />
          {t("fog.enabled")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => window.confirm(t("fog.hideAllConfirm")) && run(table.resetFog("hide"))}>
            {t("fog.hideAll")}
          </Button>
          <Button size="sm" onClick={() => run(table.resetFog("reveal"))}>
            {t("fog.revealAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run(table.undoFog())} disabled={table.fog.length === 0}>
            {t("fog.undo")}
          </Button>
        </div>
        <p className="text-xs text-parchment-500">{t("notImplemented.lighting")}</p>
      </div>
    </Section>
  );
}

function ToolButton({ active, onClick, label, icon, small, testId }: { active: boolean; onClick(): void; label: string; icon: string; small?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        "flex items-center justify-center rounded border",
        small ? "h-7 w-7 text-xs" : "h-8 w-8",
        active ? "border-gold-500 bg-gold-500/20 text-gold-300" : "border-ink-700 text-parchment-200 hover:bg-ink-800",
      )}
    >
      {icon}
    </button>
  );
}

function SaveIndicator({ status, offline }: { status: SaveStatus; offline: boolean }) {
  const t = useT();
  if (offline) return <span className="text-xs text-blood-400">{t("save.offline")}</span>;
  const map: Record<SaveStatus, [MessageKey, string] | null> = {
    idle: null,
    saving: ["save.saving", "text-parchment-400"],
    saved: ["save.saved", "text-moss-400"],
    error: ["save.error", "text-blood-400"],
  };
  const v = map[status];
  return v ? (
    <span className={cx("text-xs", v[1])} data-testid="save-status">
      {t(v[0])}
    </span>
  ) : null;
}

function ConnectionDot({ connection }: { connection: Lobby["connection"] }) {
  const t = useT();
  const key: MessageKey = connection === "connected" ? "conn.connected" : connection === "reconnecting" ? "conn.reconnecting" : "conn.connecting";
  return (
    <span className="flex items-center gap-1.5 text-xs text-parchment-400" data-testid="connection">
      <span className={cx("h-2 w-2 rounded-full", connection === "connected" ? "bg-moss-400" : "animate-pulse bg-gold-400")} />
      {t(key)}
    </span>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="border-b border-ink-700 bg-ink-850 px-3 py-1 text-xs text-parchment-400">{children}</div>;
}

function Sidebar({ open, onToggle, side, children }: { open: boolean; onToggle(): void; side: "left" | "right"; children: ReactNode }) {
  return (
    <>
      <aside
        className={cx(
          "scroll-thin z-10 shrink-0 overflow-y-auto border-ink-700 bg-ink-900/95 transition-[width]",
          side === "left" ? "border-r" : "border-l",
          open ? "w-[300px] max-md:absolute max-md:inset-y-0 max-md:w-[85vw]" : "w-0 overflow-hidden",
          side === "right" && "max-md:right-0",
        )}
      >
        {open && <div className="space-y-1 p-2">{children}</div>}
      </aside>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Toggle panel"
        className={cx(
          "absolute top-2 z-20 h-8 w-5 rounded bg-ink-800 text-xs text-parchment-400 hover:text-parchment-50",
          side === "left" ? (open ? "left-[300px] max-md:left-[85vw]" : "left-0") : open ? "right-[300px] max-md:right-[85vw]" : "right-0",
        )}
      >
        {(side === "left") === open ? "‹" : "›"}
      </button>
    </>
  );
}

function Section({ title, children, grow }: { title: string; children: ReactNode; grow?: boolean }) {
  return (
    <section className={cx("rounded-md border border-ink-700 bg-ink-850/60", grow && "flex-1")}>
      <h3 className="border-b border-ink-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gold-400">{title}</h3>
      <div className="p-2.5">{children}</div>
    </section>
  );
}
