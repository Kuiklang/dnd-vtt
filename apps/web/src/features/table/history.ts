import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FogShape } from "@vtt/rules";
import { errorMessage } from "../../lib/api";
import { toast } from "../../stores/toast";
import type { TemplateDto, TokenDto } from "./types";
import type { Table, TemplateInput, TokenInput } from "./useTable";

/**
 * Undo/redo for your own map edits (Phase 7). Each step is undone by sending the
 * opposite of what you did through the normal server actions, so permissions and
 * validation are checked again and everyone sees the result in realtime.
 *
 * Covered: token create/move/edit/delete, fog shapes, area templates. Not covered
 * (they have their own undo or can't be reversed safely): HP/conditions, "hide/reveal
 * all" fog resets, scene settings.
 */
interface Step {
  label: string;
  /** Reverts the step and returns the step that redoes it. */
  revert(): Promise<Step>;
  /** For merging rapid edits of the same thing (e.g. dragging a colour picker). */
  key?: string;
  at: number;
}

const LIMIT = 50;
const MERGE_MS = 1200;

/** Token fields worth restoring (the ones a client can send). */
const TOKEN_KEYS = ["name", "imageAssetId", "x", "y", "size", "rotation", "layer", "shape", "color", "borderColor", "hidden", "locked", "showName", "ownerIds", "hpVisibility", "characterId", "sight", "light"] as const;
const TEMPLATE_KEYS = ["shape", "x", "y", "size", "width", "angle", "color", "label", "hidden"] as const;

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** Everything needed to recreate a token, including HP/AC tracked on the token itself. */
function tokenSnapshot(t: TokenDto): TokenInput & { x: number; y: number } {
  const base = pick(t, TOKEN_KEYS) as TokenInput & { x: number; y: number };
  const v = t.vitals;
  if (v && v.source === "token" && v.hp)
    base.stats = { hp: v.hp, ac: v.ac, initiativeBonus: v.initiativeBonus ?? 0, conditions: v.conditions, defenses: v.defenses, statBlock: t.statBlock ?? null };
  return base;
}

export function useTableHistory(raw: Table) {
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const [past, setPast] = useState<Step[]>([]);
  const [future, setFuture] = useState<Step[]>([]);
  const busy = useRef(false);
  // A deleted-then-restored thing comes back with a new id; older steps follow the alias.
  const alias = useRef(new Map<string, string>());
  const resolve = (id: string) => {
    let cur = id;
    for (let i = 0; i < 20 && alias.current.has(cur); i++) cur = alias.current.get(cur)!;
    return cur;
  };

  // History belongs to one map.
  useEffect(() => {
    setPast([]);
    setFuture([]);
    alias.current.clear();
  }, [raw.sceneId]);

  const record = useCallback((step: Step) => {
    setFuture([]);
    setPast((p) => {
      const top = p[p.length - 1];
      // Merge rapid repeats of the same edit: keep the oldest "before".
      if (top && step.key && top.key === step.key && step.at - top.at < MERGE_MS) return [...p.slice(0, -1), { ...top, at: step.at }];
      return [...p, step].slice(-LIMIT);
    });
  }, []);

  // ---- Step builders -------------------------------------------------------------

  const tokenUpdate = (id: string, before: TokenInput, after: TokenInput, label: string): Step => ({
    label,
    at: Date.now(),
    key: `token:${id}:${Object.keys(after).sort().join(",")}`,
    async revert() {
      if (!(await rawRef.current.updateToken(resolve(id), before))) throw new Error("the server refused it");
      return tokenUpdate(id, after, before, label);
    },
  });
  const tokenCreated = (id: string, name: string): Step => ({
    label: `add ${name}`,
    at: Date.now(),
    async revert() {
      const cur = rawRef.current.tokens.get(resolve(id));
      if (!cur) throw new Error(`${name} is already gone`);
      await rawRef.current.deleteToken(cur.id);
      return tokenDeleted(id, tokenSnapshot(cur), name);
    },
  });
  const tokenDeleted = (id: string, snap: TokenInput & { x: number; y: number }, name: string): Step => ({
    label: `delete ${name}`,
    at: Date.now(),
    async revert() {
      const t = await rawRef.current.createToken(snap);
      alias.current.set(resolve(id), t.id);
      return tokenCreated(id, name);
    },
  });
  const fogAdded = (opId: string, mode: "reveal" | "hide", shape: FogShape): Step => ({
    label: mode === "reveal" ? "reveal fog" : "hide area",
    at: Date.now(),
    async revert() {
      const last = rawRef.current.fog[rawRef.current.fog.length - 1];
      if (!last || last.id !== resolve(opId)) throw new Error("The fog changed since; use Undo last fog shape instead");
      await rawRef.current.undoFog();
      return fogRemoved(opId, mode, shape);
    },
  });
  const fogRemoved = (opId: string, mode: "reveal" | "hide", shape: FogShape): Step => ({
    label: mode === "reveal" ? "reveal fog" : "hide area",
    at: Date.now(),
    async revert() {
      const op = (await rawRef.current.addFog(mode, shape)) as { id: string };
      alias.current.set(resolve(opId), op.id);
      return fogAdded(opId, mode, shape);
    },
  });
  const templateUpdate = (id: string, before: Partial<TemplateInput>, after: Partial<TemplateInput>): Step => ({
    label: "edit template",
    at: Date.now(),
    key: `template:${id}:${Object.keys(after).sort().join(",")}`,
    async revert() {
      await rawRef.current.updateTemplate(resolve(id), before);
      return templateUpdate(id, after, before);
    },
  });
  const templateCreated = (id: string): Step => ({
    label: "place template",
    at: Date.now(),
    async revert() {
      const cur = rawRef.current.templates.find((x) => x.id === resolve(id));
      if (!cur) throw new Error("That template is already gone");
      await rawRef.current.deleteTemplate(cur.id);
      return templateDeleted(id, pick(cur, TEMPLATE_KEYS) as TemplateInput);
    },
  });
  const templateDeleted = (id: string, snap: TemplateInput): Step => ({
    label: "remove template",
    at: Date.now(),
    async revert() {
      const t = await rawRef.current.createTemplate(snap);
      alias.current.set(resolve(id), t.id);
      return templateCreated(id);
    },
  });

  // ---- Wrapped actions -----------------------------------------------------------

  const createToken = useCallback(
    async (token: TokenInput & { x: number; y: number }) => {
      const t = await rawRef.current.createToken(token);
      record(tokenCreated(t.id, t.name));
      return t;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );
  const updateToken = useCallback(
    async (id: string, patch: TokenInput) => {
      const cur = rawRef.current.tokens.get(id);
      const keys = (Object.keys(patch) as Array<keyof TokenInput>).filter((k) => (TOKEN_KEYS as readonly string[]).includes(k as string));
      const before = cur ? (Object.fromEntries(keys.map((k) => [k, cur[k as keyof TokenDto]])) as TokenInput) : null;
      const ok = await rawRef.current.updateToken(id, patch);
      // A refused edit was rolled back: nothing to undo.
      if (!ok || !cur || !before || keys.length === 0) return ok;
      const after = Object.fromEntries(keys.map((k) => [k, patch[k]])) as TokenInput;
      if (JSON.stringify(before) === JSON.stringify(after)) return ok;
      record(tokenUpdate(id, before, after, keys.length === 2 && keys.includes("x") && keys.includes("y") ? `move ${cur.name}` : `edit ${cur.name}`));
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );
  const deleteToken = useCallback(
    async (id: string) => {
      const cur = rawRef.current.tokens.get(id);
      await rawRef.current.deleteToken(id);
      if (cur) record(tokenDeleted(id, tokenSnapshot(cur), cur.name));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );
  const addFog = useCallback(
    async (mode: "reveal" | "hide", shape: FogShape) => {
      const op = (await rawRef.current.addFog(mode, shape)) as { id: string } | undefined;
      if (op?.id) record(fogAdded(op.id, mode, shape));
      return op;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );
  const createTemplate = useCallback(
    async (t: TemplateInput) => {
      const dto = await rawRef.current.createTemplate(t);
      record(templateCreated(dto.id));
      return dto;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );
  const updateTemplate = useCallback(
    async (id: string, patch: Partial<TemplateInput>) => {
      const cur = rawRef.current.templates.find((x) => x.id === id);
      await rawRef.current.updateTemplate(id, patch);
      if (!cur) return;
      const keys = Object.keys(patch) as Array<keyof TemplateInput>;
      const before = Object.fromEntries(keys.map((k) => [k, cur[k as keyof TemplateDto]])) as Partial<TemplateInput>;
      record(templateUpdate(id, before, patch));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );
  const deleteTemplate = useCallback(
    async (id: string) => {
      const cur = rawRef.current.templates.find((x) => x.id === id);
      await rawRef.current.deleteTemplate(id);
      if (cur) record(templateDeleted(id, pick(cur, TEMPLATE_KEYS) as TemplateInput));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );

  // ---- Undo / redo ----------------------------------------------------------------

  const run = useCallback(async (from: "past" | "future") => {
    if (busy.current) return;
    const stack = from === "past" ? past : future;
    const step = stack[stack.length - 1];
    if (!step) return;
    busy.current = true;
    const pop = from === "past" ? setPast : setFuture;
    const push = from === "past" ? setFuture : setPast;
    pop((s) => s.slice(0, -1));
    try {
      const inverse = await step.revert();
      push((s) => [...s, inverse].slice(-LIMIT));
    } catch (e) {
      toast.error(`${from === "past" ? "Can't undo" : "Can't redo"} ${step.label}: ${errorMessage(e)}`);
    } finally {
      busy.current = false;
    }
  }, [past, future]);

  const undo = useCallback(() => run("past"), [run]);
  const redo = useCallback(() => run("future"), [run]);

  const table: Table = useMemo(
    () => ({ ...raw, createToken, updateToken, deleteToken, addFog, createTemplate, updateTemplate, deleteTemplate }) as Table,
    [raw, createToken, updateToken, deleteToken, addFog, createTemplate, updateTemplate, deleteTemplate],
  );

  return {
    table,
    undo,
    redo,
    undoLabel: past[past.length - 1]?.label ?? null,
    redoLabel: future[future.length - 1]?.label ?? null,
  };
}
