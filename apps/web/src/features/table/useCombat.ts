import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionEconomy, HpAction, TokenCondition } from "@vtt/rules";
import { errorMessage } from "../../lib/api";
import { emitAck, getSocket } from "../../lib/socket";
import { toast } from "../../stores/toast";
import type { CombatDto, TokenDto } from "./types";

/**
 * The campaign's running combat (one at a time), as the server lets this viewer see it.
 * Every change goes through the server, which broadcasts a per-viewer `combat:state`.
 */
export function useCombat(campaignId: string, connected: boolean) {
  const [combat, setCombat] = useState<CombatDto | null>(null);
  const [busy, setBusy] = useState(false);
  const versionRef = useRef<number | null>(null);
  versionRef.current = combat?.version ?? null;
  const combatRef = useRef(combat);
  combatRef.current = combat;

  const accept = useCallback((c: CombatDto | null) => {
    setCombat((cur) => {
      // Ignore out-of-order states for the same combat.
      if (c && cur && c.id === cur.id && c.version < cur.version) return cur;
      return c;
    });
  }, []);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    emitAck<CombatDto | null>("combat:get", { campaignId })
      .then((c) => !cancelled && setCombat(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, connected]);

  useEffect(() => {
    const s = getSocket();
    const onState = (p: { campaignId: string; combat: CombatDto | null }) => p.campaignId === campaignId && accept(p.combat);
    s.on("combat:state", onState);
    return () => {
      s.off("combat:state", onState);
    };
  }, [campaignId, accept]);

  /** Sends a combat event; the ack carries this viewer's new state. Errors become toasts. */
  const run = useCallback(
    async (event: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        const c = await emitAck<CombatDto | null>(event, { campaignId, ...payload });
        accept(c);
        return c;
      } catch (e) {
        toast.error(errorMessage(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [campaignId, accept],
  );

  /** Optimistic: checkboxes flip immediately; a refusal restores the previous state. */
  const update = useCallback(
    async (combatantId: string, patch: { hidden?: boolean; defeated?: boolean; name?: string; actions?: Partial<ActionEconomy> }) => {
      const before = combatRef.current;
      if (before) {
        setCombat({
          ...before,
          combatants: before.combatants.map((x) =>
            x.id === combatantId ? { ...x, ...patch, actions: patch.actions ? { ...x.actions, ...patch.actions } : x.actions } : x,
          ),
        });
      }
      const res = await run("combat:update", { combatantId, patch });
      if (res === undefined && before) setCombat(before);
      return res;
    },
    [run],
  );

  const applyHp = useCallback(
    async (tokenId: string, action: HpAction) => {
      try {
        const res = await emitAck<{ token: TokenDto; notes: string[]; effective: number }>("token:hp", { campaignId, tokenId, action });
        if (res.notes.length && action.kind !== "set") toast.info(res.notes.join(", "));
        return res;
      } catch (e) {
        toast.error(errorMessage(e));
        return undefined;
      }
    },
    [campaignId],
  );

  const setConditions = useCallback(
    async (tokenId: string, conditions: TokenCondition[]) => {
      try {
        return await emitAck<TokenDto>("token:conditions", { campaignId, tokenId, conditions });
      } catch (e) {
        toast.error(errorMessage(e));
        return undefined;
      }
    },
    [campaignId],
  );

  return {
    combat,
    busy,
    start: (sceneId: string, tokenIds?: string[]) => run("combat:start", { sceneId, tokenIds }),
    end: () => run("combat:end"),
    addTokens: (tokenIds: string[]) => run("combat:add", { tokenIds }),
    addCustom: (name: string, initiativeBonus: number, hidden: boolean) => run("combat:addCustom", { name, initiativeBonus, hidden }),
    remove: (combatantId: string) => run("combat:remove", { combatantId }),
    roll: (which: "all" | "npcs" | string[]) => run("combat:roll", { which }),
    setInitiative: (combatantId: string, value: number | null) => run("combat:setInitiative", { combatantId, value }),
    /** Passes the version so a double-click can't skip two turns. */
    next: () => run("combat:next", versionRef.current ? { expectedVersion: versionRef.current } : {}),
    prev: () => run("combat:prev"),
    update,
    applyHp,
    setConditions,
  };
}

export type Combat = ReturnType<typeof useCombat>;
