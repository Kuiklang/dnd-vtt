import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_GRID,
  abilityModifier,
  characterDataSchema,
  monsterToCharacterData,
  type CharacterData,
  type SrdMonster,
} from "@vtt/rules";
import type { Db } from "../db/client.js";
import { campaigns, characters, encounters, journalEntries, randomTables, scenes, tokens, type User } from "../db/schema.js";
import type { AssetService } from "../assets/service.js";
import type { CampaignService } from "../campaigns/service.js";
import { MAX_SCENE_PX } from "../scenes/service.js";
import { validateTable } from "../dmtools/service.js";
import { badRequest } from "../lib/errors.js";
import { packSchema, type CampaignPack, type PackMonster } from "./schema.js";
import { ZipError, normalizePath, readZip } from "./zip.js";

export const MAX_PACK_BYTES = 300 * 1024 * 1024;
const ZIP_LIMITS = { maxEntries: 400, maxTotalBytes: 400 * 1024 * 1024, maxEntryBytes: 30 * 1024 * 1024 };

export interface ImportSummary {
  campaignId: string;
  name: string;
  scenes: number;
  tokens: number;
  statBlocks: number;
  journal: number;
  encounters: number;
  tables: number;
  assets: number;
}

/** Darkvision range in feet from a senses line such as "darkvision 60 ft., passive Perception 12". */
export function darkvisionOf(senses: string): number {
  const m = /darkvision\s+(\d+)/i.exec(senses);
  return m ? Math.min(300, Number(m[1])) : 0;
}

/** A pack monster as a campaign sheet: SRD conversion, then the pack's notes, items and coins. */
export function statBlockData(sb: CampaignPack["statBlocks"][number]): CharacterData {
  const monster: SrdMonster = { id: sb.id, name: sb.name, ...(sb.monster as PackMonster) } as SrdMonster;
  const data = monsterToCharacterData(monster);
  const m = sb.monster;
  data.notes.description = [
    `${m.size} ${m.type}${m.alignment ? `, ${m.alignment}` : ""}`,
    `AC ${m.ac}${m.acNote ? ` (${m.acNote})` : ""} · HP ${m.hp}${m.hitDice ? ` (${m.hitDice})` : ""} · ${m.speed}`,
    m.senses ? `ประสาทสัมผัส: ${m.senses}` : "",
    m.languages ? `ภาษา: ${m.languages}` : "",
    m.conditionImmunities?.length ? `ภูมิต่อสภาพ: ${m.conditionImmunities.join(", ")}` : "",
    `CR ${m.cr} (${m.xp} XP)`,
    sb.notes,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 10000);
  data.inventory = sb.inventory.map((it) => ({
    id: randomUUID().slice(0, 12),
    name: it.name,
    category: it.category ?? "gear",
    quantity: it.quantity ?? 1,
    weight: it.weight ?? 0,
    equipped: it.equipped ?? false,
    notes: it.notes ?? "",
  }));
  data.currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...sb.currency };
  return characterDataSchema.parse(data);
}

export class CampaignPackService {
  constructor(
    private readonly db: Db,
    private readonly campaignService: CampaignService,
    private readonly assets: AssetService,
  ) {}

  /** Checks the whole pack before anything is written, so a bad pack leaves no half-made campaign. */
  parse(zip: Buffer): { pack: CampaignPack; files: Map<string, Buffer> } {
    let files: Map<string, Buffer>;
    try {
      files = readZip(zip, ZIP_LIMITS);
    } catch (e) {
      if (e instanceof ZipError) throw badRequest(e.message);
      throw e;
    }
    // Allow the whole pack to sit in one top-level folder (what "Send to → Compressed folder" makes).
    let manifestPath = [...files.keys()].find((k) => k === "campaign.json") ?? [...files.keys()].find((k) => /^[^/]+\/campaign\.json$/.test(k));
    if (!manifestPath) throw badRequest("This zip has no campaign.json, so it isn't a campaign pack");
    const root = manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.indexOf("/") + 1) : "";
    let raw: unknown;
    try {
      raw = JSON.parse(files.get(manifestPath)!.toString("utf8").replace(/^﻿/, ""));
    } catch {
      throw badRequest("campaign.json isn't valid JSON");
    }
    const result = packSchema.safeParse(raw);
    if (!result.success) {
      const i = result.error.issues[0]!;
      throw badRequest(`campaign.json: ${i.path.join(".")}: ${i.message}`);
    }
    const pack = result.data;

    const byRoot = new Map<string, Buffer>();
    for (const [k, v] of files) if (k.startsWith(root)) byRoot.set(k.slice(root.length), v);

    const unique = (ids: string[], what: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) throw badRequest(`campaign.json: ${what} "${id}" is listed twice`);
        seen.add(id);
      }
      return seen;
    };
    const assetIds = unique(pack.assets.map((a) => a.id), "asset");
    const sbIds = unique(pack.statBlocks.map((s) => s.id), "stat block");
    for (const a of pack.assets) {
      if (!byRoot.has(normalizePath(a.file))) throw badRequest(`campaign.json: file "${a.file}" for asset "${a.id}" isn't in the zip`);
    }
    const needAsset = (id: string | undefined, where: string) => {
      if (id && !assetIds.has(id)) throw badRequest(`campaign.json: ${where} uses unknown image "${id}"`);
    };
    const needSb = (id: string | undefined, where: string) => {
      if (id && !sbIds.has(id)) throw badRequest(`campaign.json: ${where} uses unknown stat block "${id}"`);
    };
    for (const s of pack.scenes) {
      needAsset(s.map, `scene "${s.name}"`);
      for (const t of s.tokens) {
        needAsset(t.image, `token "${t.name}"`);
        needSb(t.statBlock, `token "${t.name}"`);
        if (t.linked && !t.statBlock) throw badRequest(`campaign.json: token "${t.name}" is linked but has no stat block`);
      }
    }
    for (const j of pack.journal) needAsset(j.image, `journal "${j.title}"`);
    for (const e of pack.encounters) for (const x of e.entries) needSb(x.statBlock, `encounter "${e.name}"`);
    for (const t of pack.tables) {
      const errors = validateTable(t.formula.replace(/\s+/g, ""), t.entries);
      if (errors.length) throw badRequest(`campaign.json: table "${t.name}": ${errors[0]}`);
    }
    for (const sb of pack.statBlocks) {
      try {
        statBlockData(sb);
      } catch (e) {
        throw badRequest(`campaign.json: stat block "${sb.id}" isn't valid: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return { pack, files: byRoot };
  }

  async import(user: User, zip: Buffer): Promise<ImportSummary> {
    const { pack, files } = this.parse(zip);
    const campaign = await this.campaignService.create(user, {
      name: pack.campaign.name,
      description: pack.campaign.description,
      coverImageUrl: null,
      rulesetId: pack.campaign.rulesetId,
      setting: pack.campaign.setting,
      theme: "dark-fantasy",
      maxPlayers: pack.campaign.maxPlayers,
      privacy: "invite_only",
      password: null,
      houseRules: pack.campaign.houseRules,
    });
    try {
      return await this.fill(user, campaign.id, pack, files);
    } catch (e) {
      // Leave nothing behind: the campaign row cascades to everything created so far.
      await this.db.delete(campaigns).where(eq(campaigns.id, campaign.id));
      throw e;
    }
  }

  private async fill(user: User, campaignId: string, pack: CampaignPack, files: Map<string, Buffer>): Promise<ImportSummary> {
    const assetMap = new Map<string, { id: string; width: number | null; height: number | null }>();
    for (const a of pack.assets) {
      const row = await this.assets.upload(user, { kind: a.kind, campaignId, data: files.get(normalizePath(a.file))!, filename: a.file.split("/").pop()! });
      assetMap.set(a.id, { id: row.id, width: row.width, height: row.height });
    }

    const sheets = new Map<string, { id: string; sb: CampaignPack["statBlocks"][number] }>();
    for (const sb of pack.statBlocks) {
      const [row] = await this.db
        .insert(characters)
        .values({
          ownerId: user.id,
          campaignId,
          kind: sb.kind,
          name: sb.name,
          rulesetId: pack.campaign.rulesetId,
          data: statBlockData(sb),
          playerVisible: sb.playerVisible,
        })
        .returning({ id: characters.id });
      sheets.set(sb.id, { id: row!.id, sb });
    }

    let tokenCount = 0;
    let firstSceneId: string | null = null;
    for (const [i, s] of pack.scenes.entries()) {
      const grid = { ...DEFAULT_GRID, ...s.grid };
      const bg = s.map ? assetMap.get(s.map)! : null;
      const width = s.width ?? bg?.width ?? Math.round((s.cols ?? 30) * grid.size);
      const height = s.height ?? bg?.height ?? Math.round((s.rows ?? 20) * grid.size);
      if (width < 100 || height < 100 || width > MAX_SCENE_PX || height > MAX_SCENE_PX) {
        throw badRequest(`Scene "${s.name}" must be between 100 and ${MAX_SCENE_PX} pixels on each side`);
      }
      const [scene] = await this.db
        .insert(scenes)
        .values({
          campaignId,
          name: s.name,
          backgroundAssetId: bg?.id ?? null,
          backgroundColor: s.backgroundColor,
          width,
          height,
          grid,
          fogEnabled: s.fogEnabled,
          vision: s.vision,
          dmNotes: s.dmNotes,
          sortOrder: i,
        })
        .returning({ id: scenes.id });
      firstSceneId ??= scene!.id;
      if (s.tokens.length) {
        await this.db.insert(tokens).values(
          s.tokens.map((t) => {
            const sheet = t.statBlock ? sheets.get(t.statBlock)! : null;
            const m = sheet?.sb.monster;
            const dv = m ? darkvisionOf(m.senses) : 0;
            return {
              sceneId: scene!.id,
              campaignId,
              characterId: t.linked && sheet ? sheet.id : null,
              name: t.name,
              imageAssetId: t.image ? assetMap.get(t.image)!.id : null,
              // Token x/y is the centre in scene pixels.
              x: grid.offsetX + (t.cell[0] + t.size / 2) * grid.size,
              y: grid.offsetY + (t.cell[1] + t.size / 2) * grid.size,
              size: t.size,
              layer: t.layer,
              shape: t.shape,
              color: t.color,
              borderColor: t.borderColor,
              hidden: t.hidden,
              locked: t.locked,
              showName: t.showName,
              hpVisibility: t.hpVisibility,
              stats:
                sheet && m && !t.linked
                  ? {
                      hp: { current: m.hp, max: m.hp, temp: 0 },
                      ac: m.ac,
                      initiativeBonus: abilityModifier(m.abilities.dex),
                      conditions: [],
                      defenses: { resistances: m.resistances ?? [], vulnerabilities: m.vulnerabilities ?? [], immunities: m.immunities ?? [] },
                      statBlock: { type: "character" as const, id: sheet.id },
                    }
                  : null,
              sight: dv ? { darkvision: dv } : null,
              light: t.light,
            };
          }),
        );
        tokenCount += s.tokens.length;
      }
    }
    if (firstSceneId) await this.db.update(campaigns).set({ activeSceneId: firstSceneId }).where(eq(campaigns.id, campaignId));

    for (const j of pack.journal) {
      await this.db.insert(journalEntries).values({
        campaignId,
        authorId: user.id,
        title: j.title,
        body: j.body,
        folder: j.folder,
        visibility: j.visibility,
        imageAssetId: j.image ? assetMap.get(j.image)!.id : null,
        pinned: j.pinned,
      });
    }

    for (const e of pack.encounters) {
      await this.db.insert(encounters).values({
        campaignId,
        name: e.name,
        notes: e.notes,
        entries: e.entries.map((x) => {
          const sheet = sheets.get(x.statBlock)!;
          return { ref: { type: "character" as const, id: sheet.id }, name: sheet.sb.name, count: x.count, xp: sheet.sb.monster.xp };
        }),
      });
    }

    for (const t of pack.tables) {
      await this.db.insert(randomTables).values({ campaignId, name: t.name, formula: t.formula.replace(/\s+/g, ""), entries: t.entries });
    }

    return {
      campaignId,
      name: pack.campaign.name,
      scenes: pack.scenes.length,
      tokens: tokenCount,
      statBlocks: pack.statBlocks.length,
      journal: pack.journal.length,
      encounters: pack.encounters.length,
      tables: pack.tables.length,
      assets: pack.assets.length,
    };
  }
}
