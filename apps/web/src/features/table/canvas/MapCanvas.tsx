import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Circle, Image as KImage, Layer, Line, Rect, Shape, Stage, Text, Group } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import {
  TOKEN_LAYERS,
  canControlToken,
  pathDistance,
  snapToGrid,
  type DiagonalRule,
  type FogShape,
  type Point,
} from "@vtt/rules";
import type { FogOpDto, FogShapeKind, SceneDto, TokenDto, Tool } from "../types";
import { drawFog, drawGrid, traceShape } from "./draw";
import { TokenNode } from "./TokenNode";

export interface MapCanvasHandle {
  fit(): void;
  /** Centre of the current view in scene coordinates (for dropping new tokens). */
  viewCenter(): Point;
}

interface Props {
  scene: SceneDto;
  tokens: TokenDto[];
  fog: FogOpDto[];
  myId: string;
  isGM: boolean;
  tool: Tool;
  fogShape: FogShapeKind;
  spaceHeld: boolean;
  diagonal: DiagonalRule;
  selectedId: string | null;
  /** Token whose turn it is in the running combat. */
  activeTokenId?: string | null;
  /** Tokens marked defeated in the running combat. */
  defeatedIds?: Set<string>;
  onSelect(id: string | null): void;
  onMoveToken(id: string, x: number, y: number): void;
  onFogShape(mode: "reveal" | "hide", shape: FogShape): void;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 6;
const layerOrder = (l: TokenDto["layer"]) => TOKEN_LAYERS.indexOf(l);

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(props, ref) {
  const { scene, tokens, fog, myId, isGM, tool, fogShape, spaceHeld, diagonal, selectedId, activeTokenId, defeatedIds, onSelect, onMoveToken, onFogShape } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [bg] = useImage(scene.backgroundUrl ?? "", "anonymous");
  const [cursor, setCursor] = useState<Point | null>(null);
  const [measure, setMeasure] = useState<Point[]>([]);
  const [draft, setDraft] = useState<{ start: Point; current: Point } | null>(null);
  const [poly, setPoly] = useState<Point[]>([]);
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const scale = Math.min(size.w / scene.width, size.h / scene.height) * 0.95;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    setView({ scale: s, x: (size.w - scene.width * s) / 2, y: (size.h - scene.height * s) / 2 });
  }, [size, scene.width, scene.height]);

  // Fit once per scene, after the container has a real size.
  useEffect(() => {
    if (fitted.current !== scene.id && size.w > 50) {
      fitted.current = scene.id;
      fit();
    }
  }, [scene.id, size.w, fit]);

  useImperativeHandle(ref, () => ({
    fit,
    viewCenter: () => ({ x: (size.w / 2 - view.x) / view.scale, y: (size.h / 2 - view.y) / view.scale }),
  }));

  // Reset in-progress drawings when the tool changes.
  useEffect(() => {
    setMeasure([]);
    setDraft(null);
    setPoly([]);
  }, [tool, fogShape, scene.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMeasure([]);
        setDraft(null);
        setPoly([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const scenePoint = (): Point | null => stageRef.current?.getRelativePointerPosition() ?? null;
  const snap = (p: Point) => (scene.grid.type === "none" ? p : snapToGrid(p, scene.grid));

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12;
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const anchor = { x: (pointer.x - v.x) / v.scale, y: (pointer.y - v.y) / v.scale };
      return { scale, x: pointer.x - anchor.x * scale, y: pointer.y - anchor.y * scale };
    });
  };

  const isFogTool = tool === "fog-reveal" || tool === "fog-hide";
  const fogMode = tool === "fog-reveal" ? "reveal" : "hide";
  const stageDraggable = tool === "pan" || spaceHeld || tool === "select";

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (spaceHeld) return;
    const p = scenePoint();
    if (!p) return;
    if (tool === "select" && e.target === e.target.getStage()) onSelect(null);
    if (isFogTool && fogShape !== "polygon") setDraft({ start: p, current: p });
  };

  const onMouseMove = () => {
    const p = scenePoint();
    if (!p) return;
    setCursor(p);
    if (draft) setDraft({ ...draft, current: p });
  };

  const onMouseUp = () => {
    if (!draft) return;
    const { start, current } = draft;
    setDraft(null);
    const shape: FogShape =
      fogShape === "circle"
        ? { kind: "circle", x: start.x, y: start.y, radius: Math.hypot(current.x - start.x, current.y - start.y) }
        : { kind: "rect", x: start.x, y: start.y, width: current.x - start.x, height: current.y - start.y };
    const big = shape.kind === "circle" ? shape.radius > 3 : Math.abs(shape.width) > 3 && Math.abs(shape.height) > 3;
    if (big) onFogShape(fogMode, shape);
  };

  const onClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || spaceHeld) return;
    const p = scenePoint();
    if (!p) return;
    if (tool === "measure") setMeasure((m) => [...m, snap(p)]);
    if (isFogTool && fogShape === "polygon") setPoly((pts) => [...pts, p]);
  };

  const onDblClick = () => {
    if (tool === "measure") setMeasure([]);
    if (isFogTool && fogShape === "polygon") {
      // The double-click's two clicks both added points; drop the duplicate.
      const pts = poly.slice(0, -1);
      setPoly([]);
      if (pts.length >= 3) onFogShape(fogMode, { kind: "polygon", points: pts });
    }
  };

  const sorted = useMemo(() => [...tokens].sort((a, b) => layerOrder(a.layer) - layerOrder(b.layer)), [tokens]);
  const viewer = useMemo(() => ({ userId: myId, isGameMaster: isGM }), [myId, isGM]);
  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      const t = tokens.find((tk) => tk.id === id);
      const p = scene.grid.type === "none" ? { x, y } : snapToGrid({ x, y }, scene.grid, Math.max(1, Math.round(t?.size ?? 1)));
      const cx = Math.min(Math.max(p.x, 0), scene.width);
      const cy = Math.min(Math.max(p.y, 0), scene.height);
      onMoveToken(id, cx, cy);
    },
    [tokens, scene.grid, scene.width, scene.height, onMoveToken],
  );

  const bounds = {
    x0: -view.x / view.scale,
    y0: -view.y / view.scale,
    x1: (size.w - view.x) / view.scale,
    y1: (size.h - view.y) / view.scale,
  };

  const measurePts = measure.length && cursor ? [...measure, snap(cursor)] : measure;
  const measureLabel =
    measurePts.length >= 2 ? `${pathDistance(measurePts, scene.grid, diagonal)} ${scene.grid.unit}` : null;
  const lastMeasure = measurePts[measurePts.length - 1];

  const draftShape: FogShape | null = draft
    ? fogShape === "circle"
      ? { kind: "circle", x: draft.start.x, y: draft.start.y, radius: Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y) }
      : { kind: "rect", x: draft.start.x, y: draft.start.y, width: draft.current.x - draft.start.x, height: draft.current.y - draft.start.y }
    : null;
  const k = 1 / view.scale;

  // Players only receive tokens they're allowed to see (filtered by the server), so fog is drawn
  // *under* their tokens and their own token stays visible inside fog. GMs see fog over everything.
  const fogLayerEl = scene.fogEnabled && (
          <Layer name="fog" listening={false} opacity={isGM ? 0.55 : 1}>
            <Shape sceneFunc={(ctx) => drawFog(ctx._context, fog, scene.width, scene.height, isGM ? "#05040a" : "#0b0a09")} />
          </Layer>
        );

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden"
      style={{ cursor: spaceHeld || tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair" }}
      data-testid="map-canvas"
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={stageDraggable}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onDragMove={(e) => {
          if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onTouchStart={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onDblClick={onDblClick}
        onMouseLeave={() => setCursor(null)}
      >
        <Layer listening={false}>
          <Rect width={scene.width} height={scene.height} fill={scene.backgroundColor} shadowColor="#000" shadowBlur={30} shadowOpacity={0.6} />
          {bg && <KImage image={bg} width={scene.width} height={scene.height} />}
          <Shape sceneFunc={(ctx) => drawGrid(ctx._context, scene.grid, scene.width, scene.height, bounds, view.scale)} />
        </Layer>

        {!isGM && fogLayerEl}
        <Layer name="tokens" listening={!isFogTool && tool !== "measure"}>
          {sorted.map((t) => (
            <TokenNode
              key={t.id}
              token={t}
              cell={scene.grid.size}
              selected={t.id === selectedId}
              active={t.id === activeTokenId}
              defeated={!!defeatedIds?.has(t.id)}
              draggable={(tool === "select") && !spaceHeld && canControlToken(t, viewer)}
              ghost={isGM && (t.hidden || t.layer === "dm")}
              onSelect={onSelect}
              onDragEnd={handleDragEnd}
            />
          ))}
        </Layer>

        {isGM && fogLayerEl}

        <Layer listening={false}>
          {draftShape && (
            <Shape
              sceneFunc={(ctx) => {
                const c = ctx._context;
                traceShape(c, draftShape);
                c.fillStyle = fogMode === "reveal" ? "rgba(127,194,138,0.25)" : "rgba(194,70,58,0.3)";
                c.fill();
                c.lineWidth = 2 * k;
                c.strokeStyle = fogMode === "reveal" ? "#7fc28a" : "#e06a5c";
                c.stroke();
              }}
            />
          )}
          {poly.length > 0 && (
            <Line
              points={[...poly, ...(cursor ? [cursor] : [])].flatMap((p) => [p.x, p.y])}
              stroke={fogMode === "reveal" ? "#7fc28a" : "#e06a5c"}
              strokeWidth={2 * k}
              dash={[8 * k, 6 * k]}
              closed={poly.length >= 2}
              fill={fogMode === "reveal" ? "rgba(127,194,138,0.2)" : "rgba(194,70,58,0.25)"}
            />
          )}
          {measurePts.length >= 1 && (
            <Group>
              <Line points={measurePts.flatMap((p) => [p.x, p.y])} stroke="#ebcd7a" strokeWidth={3 * k} dash={[10 * k, 6 * k]} lineCap="round" />
              {measure.map((p, i) => (
                <Circle key={i} x={p.x} y={p.y} radius={4 * k} fill="#ebcd7a" />
              ))}
              {measureLabel && lastMeasure && (
                <Group x={lastMeasure.x + 12 * k} y={lastMeasure.y - 28 * k} scaleX={k} scaleY={k}>
                  <Rect width={96} height={26} fill="#13110f" cornerRadius={6} opacity={0.9} stroke="#c39a33" strokeWidth={1} />
                  <Text text={measureLabel} width={96} height={26} align="center" verticalAlign="middle" fill="#ebcd7a" fontSize={14} fontStyle="bold" />
                </Group>
              )}
            </Group>
          )}
        </Layer>
      </Stage>
    </div>
  );
});
