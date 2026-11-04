import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { getBuiltinRuleset } from "@vtt/rules";
import { HttpError, forbidden } from "../lib/errors.js";
import type { Config } from "../config.js";
import type { AppContext } from "../context.js";
import type { Membership } from "../campaigns/service.js";
import { runClaudeCli } from "./claudeCli.js";

/**
 * The DM's AI assistant (Phase 8): improvise descriptions, NPCs, names, encounter ideas
 * and rules answers, grounded in the campaign (setting, party, current map and recent log).
 * DM-only. Uses the Claude Code CLI signed in on the server's computer (free with the
 * DM's Claude plan) or the Claude API when a key is configured.
 */

export const ASSIST_MODES = ["ask", "describe", "npc", "names", "encounter", "rules", "loot"] as const;
export type AssistMode = (typeof ASSIST_MODES)[number];

export interface TextModel {
  readonly name: string;
  complete(system: string, prompt: string): Promise<string>;
}

/** Claude Code CLI with no tools at all: it only writes text. */
export class ClaudeCodeText implements TextModel {
  readonly name = "claude-code";
  constructor(private readonly opts: { command: string; model?: string }) {}

  async complete(system: string, prompt: string): Promise<string> {
    // An empty folder as the working directory, so nothing local is in reach.
    const dir = await mkdtemp(join(tmpdir(), "vtt-ai-"));
    try {
      const res = await runClaudeCli({ ...this.opts, timeoutMs: 3 * 60_000 }, ["--tools", "", "--system-prompt", system], dir, prompt);
      const text = (res.result ?? "").trim();
      if (!text) throw new HttpError(502, "ai_failed", "Claude returned an empty answer. Please try again.");
      return text;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export class ApiText implements TextModel {
  readonly name = "api";
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 3 * 60_000, maxRetries: 2 });
  }

  async complete(system: string, prompt: string): Promise<string> {
    try {
      const res = await this.client.messages.create({ model: this.model, max_tokens: 4000, system, messages: [{ role: "user", content: prompt }] });
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      if (!text) throw new HttpError(502, "ai_failed", "Claude returned an empty answer. Please try again.");
      return text;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new HttpError(503, "ai_unavailable", "The server's API key was rejected.");
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "rate_limited", "Claude is busy. Try again in a minute.");
      if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) throw new HttpError(502, "ai_failed", "Claude is unavailable right now. Please try again.");
      throw e;
    }
  }
}

/** Picks the AI provider from .env (AI_PROVIDER), the same choice the sheet reader uses by default. */
export function textModelFromConfig(cfg: Pick<Config, "AI_PROVIDER" | "ANTHROPIC_API_KEY" | "IMPORT_MODEL" | "CLAUDE_CODE_PATH" | "CLAUDE_CODE_MODEL">): TextModel | null {
  switch (cfg.AI_PROVIDER) {
    case "off":
      return null;
    case "claude-code":
      return new ClaudeCodeText({ command: cfg.CLAUDE_CODE_PATH, model: cfg.CLAUDE_CODE_MODEL || undefined });
    case "api":
    case "auto":
      return cfg.ANTHROPIC_API_KEY ? new ApiText(cfg.ANTHROPIC_API_KEY, cfg.IMPORT_MODEL) : null;
  }
}

const TASKS: Record<AssistMode, string> = {
  ask: "Answer the DM's request.",
  describe: "Write read-aloud boxed text (3-6 vivid sentences, second person, present tense) for what the players see, hear and smell. Then add 2-3 short bullet 'DM notes' with details players might discover by looking closer. Never reveal secrets in the read-aloud part.",
  npc: "Create one NPC that fits the request: name, a one-line look, personality (2 traits), a voice/mannerism to roleplay, what they want, a secret, and 2 lines of sample dialogue. Keep it under 180 words.",
  names: "Give 10 fitting names as a list, each with a 3-6 word note.",
  encounter: "Suggest an encounter for the party: situation, creatures (prefer the D&D 5e SRD bestiary, with rough numbers for the party's level), terrain features, a twist, and how it can end without a fight. Keep it practical and under 220 words.",
  rules: "Answer the rules question using the D&D 5e System Reference Document (SRD 5.1/5.2) rules. Be precise and short; quote the relevant rule in your own words and say when something is a DM call or not covered by the SRD.",
  loot: "Suggest a small treasure parcel that fits: coins, 1-3 mundane or SRD magic items with one-line descriptions, and one story hook item.",
};

export interface AssistContext {
  campaign: { name: string; setting: string; description: string; houseRules: string };
  rulesetName: string;
  party: string[];
  scene: { name: string; notes: string } | null;
  log: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The system prompt: who Claude is here, the campaign facts, and the task. Pure, for tests. */
export function assistSystem(mode: AssistMode, c: AssistContext, language: "th" | "en"): string {
  const lines = [
    "You are a helpful co-DM for a tabletop role-playing game, assisting the Dungeon Master during play.",
    "Be concise and immediately usable at the table. Use plain Markdown (short headings, bullets). Don't ask follow-up questions; make sensible choices.",
    "Use only original content or content from the D&D 5e System Reference Document; don't reproduce text from non-SRD books.",
    language === "th"
      ? "Write in Thai (ภาษาไทย). Keep game terms such as AC, HP, DC, ability names and spell names in English."
      : "Write in English.",
    "",
    `Task: ${TASKS[mode]}`,
    "",
    "Campaign facts (for context only; follow the DM's request):",
    `- Campaign: ${clip(c.campaign.name, 100)} (${c.rulesetName})`,
  ];
  if (c.campaign.setting) lines.push(`- Setting: ${clip(c.campaign.setting, 400)}`);
  if (c.campaign.description) lines.push(`- About: ${clip(c.campaign.description, 600)}`);
  if (c.campaign.houseRules) lines.push(`- House rules: ${clip(c.campaign.houseRules, 600)}`);
  if (c.party.length) lines.push(`- Party: ${c.party.map((p) => clip(p, 120)).join("; ")}`);
  if (c.scene) lines.push(`- Current map: ${clip(c.scene.name, 100)}${c.scene.notes ? `. DM notes: ${clip(c.scene.notes, 1200)}` : ""}`);
  if (c.log.length) lines.push("- Recent table log (oldest first):", ...c.log.map((l) => `  · ${clip(l, 200)}`));
  return lines.join("\n");
}

export class AssistantService {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly ctx: AppContext,
    private readonly model: TextModel | null,
    private readonly perHour: number,
  ) {}

  get available() {
    return !!this.model;
  }
  get provider() {
    return this.model?.name ?? null;
  }

  private take(userId: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.perHour) return (this.hits.set(userId, recent), false);
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }

  async context(m: Membership): Promise<AssistContext> {
    const detail = await this.ctx.campaigns.detail(m);
    const scene = m.campaign.activeSceneId ? await this.ctx.scenes.viewableRaw(m.campaign.id, m.campaign.activeSceneId) : null;
    const history = await this.ctx.chat.history(m, { limit: 40 });
    const log = history
      .filter((h) => !h.deleted && (h.channel === "global" || h.channel === "system" || h.channel === "party"))
      .slice(-25)
      .map((h) => (h.channel === "system" ? h.content : `${h.characterName ?? h.senderName ?? "?"}: ${h.content}`));
    return {
      campaign: { name: m.campaign.name, setting: m.campaign.setting, description: m.campaign.description, houseRules: m.campaign.houseRules },
      rulesetName: getBuiltinRuleset(m.campaign.rulesetId)?.name ?? m.campaign.rulesetId,
      party: detail.members.flatMap((x) => (x.character ? [`${x.character.name} (${x.character.summary})`] : [])),
      scene: scene ? { name: scene.name, notes: scene.dmNotes } : null,
      log,
    };
  }

  async assist(m: Membership, input: { mode: AssistMode; prompt: string; language: "th" | "en" }): Promise<{ text: string; provider: string }> {
    if (!m.caps.has("dmNotes.view")) throw forbidden("Only the DM can use the AI assistant");
    if (!this.model) throw new HttpError(503, "ai_unavailable", "The AI assistant isn't set up on this server. Set AI_PROVIDER=claude-code (free with Claude Code signed in on the server computer) or ANTHROPIC_API_KEY in the server's .env.");
    if (!this.take(m.member.userId)) throw new HttpError(429, "rate_limited", "You've asked the AI a lot this hour. Try again later.");
    const system = assistSystem(input.mode, await this.context(m), input.language);
    const text = await this.model.complete(system, input.prompt.trim() || "Go ahead.");
    return { text, provider: this.model.name };
  }
}
