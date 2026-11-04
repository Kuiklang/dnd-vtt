import { useCallback, useEffect, useRef, useState } from "react";
import type { FogShape } from "@vtt/rules";
import { api, errorMessage } from "../../lib/api";
import { emitAck, getSocket } from "../../lib/socket";
import { toast } from "../../stores/toast";
import type { FogOpDto, SceneDto, SceneState, TokenDto } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Scene state for the table view: scene list (REST), the open scene (socket room),
 * tokens and fog kept in sync with server broadcasts. Token moves are optimistic:
 * applied locally, sent, and rolled back if the server refuses.
 */
export function useTable(campaignId: string, isGM: boolean, connected: boolean) {
  const [scenes, setScenes] = useState<SceneDto[] | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneDto | null>(null);
  const [tokens, setTokens] = useState<Map<string, TokenDto>>(new Map());
  const [fog, setFog] = useState<FogOpDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveStatus>("idle");
  const pending = useRef(0);
  const sceneIdRef = useRef<string | null>(null);
  sceneIdRef.current = sceneId;
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    pending.current++;
    setSave("saving");
    try {
      const r = await p;
      pending.current--;
      if (pending.current === 0) setSave("saved");
      return r;
    } catch (e) {
      pending.current--;
      setSave("error");
      throw e;
    }
  }, []);

  const applyState = useCallback((s: SceneState) => {
    setScene(s.scene);
    setTokens(new Map(s.tokens.map((t) => [t.id, t])));
    setFog(s.fog);
  }, []);

  const loadScenes = useCallback(async () => {
    try {
      const res = await api.get<{ scenes: SceneDto[]; activeSceneId?: string | null }>(`/api/campaigns/${campaignId}/scenes`);
      setScenes(res.scenes);
      setError(null);
      setSceneId((current) => {
        if (current && res.scenes.some((s) => s.id === current)) return current;
        // Default to the scene players are on.
        return res.scenes.find((s) => s.isActive)?.id ?? (isGM ? (res.scenes[0]?.id ?? null) : null);
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [campaignId, isGM]);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  // Join the scene room whenever the scene or connection changes (also recovers state after reconnect).
  useEffect(() => {
    if (!sceneId || !connected) return;
    let cancelled = false;
    emitAck<SceneState>("scene:join", { campaignId, sceneId })
      .then((s) => !cancelled && applyState(s))
      .catch((e) => {
        if (cancelled) return;
        toast.error(errorMessage(e));
        void loadScenes();
      });
    return () => {
      cancelled = true;
      const s = getSocket();
      if (s.connected) s.emit("scene:leave", { campaignId, sceneId });
    };
  }, [campaignId, sceneId, connected, applyState, loadScenes]);

  useEffect(() => {
    if (!sceneId) {
      setScene(null);
      setTokens(new Map());
      setFog([]);
    }
  }, [sceneId]);

  useEffect(() => {
    const s = getSocket();
    const onUpsert = (t: TokenDto) => {
      if (t.sceneId !== sceneIdRef.current) return;
      setTokens((m) => {
        const cur = m.get(t.id);
        if (cur && cur.version > t.version) return m; // stale broadcast
        const next = new Map(m);
        next.set(t.id, t);
        return next;
      });
    };
    const onRemove = (p: { sceneId: string; tokenId: string }) => {
      if (p.sceneId !== sceneIdRef.current) return;
      setTokens((m) => {
        if (!m.has(p.tokenId)) return m;
        const next = new Map(m);
        next.delete(p.tokenId);
        return next;
      });
    };
    const onState = (st: SceneState) => st.scene.id === sceneIdRef.current && applyState(st);
    const onScenesChanged = (p: { campaignId: string }) => p.campaignId === campaignId && void loadScenes();
    const onActivated = (p: { campaignId: string; sceneId: string | null }) => {
      if (p.campaignId !== campaignId) return;
      void loadScenes();
      // Players follow the DM to the new scene; GMs stay where they are.
      if (!isGM) setSceneId(p.sceneId);
    };
    const onDeleted = (p: { campaignId: string; sceneId: string }) => {
      if (p.campaignId !== campaignId) return;
      if (p.sceneId === sceneIdRef.current) setSceneId(null);
      void loadScenes();
    };
    s.on("token:upsert", onUpsert);
    s.on("token:remove", onRemove);
    s.on("scene:state", onState);
    s.on("scenes:changed", onScenesChanged);
    s.on("scene:activated", onActivated);
    s.on("scene:deleted", onDeleted);
    return () => {
      s.off("token:upsert", onUpsert);
      s.off("token:remove", onRemove);
      s.off("scene:state", onState);
      s.off("scenes:changed", onScenesChanged);
      s.off("scene:activated", onActivated);
      s.off("scene:deleted", onDeleted);
    };
  }, [campaignId, isGM, applyState, loadScenes]);

  const ref = useCallback(() => {
    if (!sceneIdRef.current) throw new Error("No map is open");
    return { campaignId, sceneId: sceneIdRef.current };
  }, [campaignId]);

  // ---- Token actions --------------------------------------------------------

  const createToken = useCallback(
    async (token: Partial<TokenDto> & { x: number; y: number }) => {
      const t = await track(emitAck<TokenDto>("token:create", { ...ref(), token: stripTokenInput(token) }));
      setTokens((m) => new Map(m).set(t.id, t));
      return t;
    },
    [ref, track],
  );

  const updateToken = useCallback(
    async (id: string, patch: Partial<TokenDto>) => {
      const before = tokensRef.current.get(id);
      if (before) setTokens((m) => new Map(m).set(id, { ...before, ...patch }));
      try {
        const t = await track(emitAck<TokenDto>("token:update", { ...ref(), tokenId: id, patch: stripTokenInput(patch) }));
        setTokens((m) => {
          const cur = m.get(id);
          if (cur && cur.version > t.version) return m;
          return new Map(m).set(id, t);
        });
      } catch (e) {
        // Roll back the optimistic change.
        if (before) setTokens((m) => new Map(m).set(id, before));
        toast.error(errorMessage(e));
      }
    },
    [ref, track],
  );

  const deleteToken = useCallback(
    async (id: string) => {
      await track(emitAck("token:delete", { ...ref(), tokenId: id }));
      setTokens((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
    },
    [ref, track],
  );

  // ---- Fog ----------------------------------------------------------------------

  const addFog = useCallback((mode: "reveal" | "hide", shape: FogShape) => track(emitAck("fog:add", { ...ref(), mode, shape })), [ref, track]);
  const resetFog = useCallback((mode: "reveal" | "hide") => track(emitAck("fog:reset", { ...ref(), mode })), [ref, track]);
  const undoFog = useCallback(() => track(emitAck("fog:undo", ref())), [ref, track]);
  const setFogEnabled = useCallback(
    async (enabled: boolean) => {
      // Optimistic toggle; the server's scene:state broadcast confirms (or the rollback below restores).
      setScene((cur) => (cur ? { ...cur, fogEnabled: enabled } : cur));
      try {
        await track(emitAck("fog:enable", { ...ref(), enabled }));
      } catch (e) {
        setScene((cur) => (cur ? { ...cur, fogEnabled: !enabled } : cur));
        throw e;
      }
    },
    [ref, track],
  );

  // ---- Scenes (REST) ----------------------------------------------------------

  const createScene = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await track(api.post<{ scene: SceneDto }>(`/api/campaigns/${campaignId}/scenes`, body));
      await loadScenes();
      setSceneId(res.scene.id);
      return res.scene;
    },
    [campaignId, loadScenes, track],
  );

  const updateScene = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await track(api.patch<{ scene: SceneDto }>(`/api/campaigns/${campaignId}/scenes/${id}`, body));
      if (id === sceneIdRef.current) setScene((cur) => (cur ? { ...cur, ...res.scene } : res.scene));
      return res.scene;
    },
    [campaignId, track],
  );

  const duplicateScene = useCallback(
    async (id: string) => {
      const res = await track(api.post<{ scene: SceneDto }>(`/api/campaigns/${campaignId}/scenes/${id}/duplicate`));
      await loadScenes();
      return res.scene;
    },
    [campaignId, loadScenes, track],
  );

  const deleteScene = useCallback(
    async (id: string) => {
      await track(api.del(`/api/campaigns/${campaignId}/scenes/${id}`));
      if (id === sceneIdRef.current) setSceneId(null);
      await loadScenes();
    },
    [campaignId, loadScenes, track],
  );

  const activateScene = useCallback(
    async (id: string | null) => {
      await track(api.post(`/api/campaigns/${campaignId}/active-scene`, { sceneId: id }));
      await loadScenes();
    },
    [campaignId, loadScenes, track],
  );

  return {
    scenes,
    sceneId,
    setSceneId,
    scene,
    tokens,
    fog,
    error,
    save,
    loadScenes,
    createToken,
    updateToken,
    deleteToken,
    addFog,
    resetFog,
    undoFog,
    setFogEnabled,
    createScene,
    updateScene,
    duplicateScene,
    deleteScene,
    activateScene,
  };
}

export type Table = ReturnType<typeof useTable>;

const TOKEN_INPUT_KEYS = [
  "characterId",
  "name",
  "imageAssetId",
  "x",
  "y",
  "size",
  "rotation",
  "layer",
  "shape",
  "color",
  "borderColor",
  "hidden",
  "locked",
  "showName",
  "ownerIds",
] as const;

/** Only send fields the server accepts as token input. */
function stripTokenInput(t: Partial<TokenDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TOKEN_INPUT_KEYS) if (t[k] !== undefined) out[k] = t[k];
  return out;
}
