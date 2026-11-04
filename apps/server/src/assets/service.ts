import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { imageSize } from "image-size";
import type { Db } from "../db/client.js";
import { assets, journalEntries, type AssetRow, type User } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import type { CampaignService } from "../campaigns/service.js";
import type { Storage } from "./storage.js";

export const ASSET_KINDS = ["map", "token", "portrait", "avatar", "cover", "handout", "audio", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Per-kind upload limits. Maps can be large battle maps. */
export const MAX_BYTES: Record<AssetKind, number> = {
  map: 25 * 1024 * 1024,
  token: 5 * 1024 * 1024,
  portrait: 5 * 1024 * 1024,
  avatar: 2 * 1024 * 1024,
  cover: 5 * 1024 * 1024,
  handout: 10 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  other: 5 * 1024 * 1024,
};
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_BYTES));
/** Largest edge we accept; bigger images hurt every client's GPU memory. */
export const MAX_DIMENSION = 16384;

/**
 * Detects the real image type from magic bytes. The client-sent MIME type and
 * file extension are ignored, so a renamed HTML/SVG file can't be smuggled in.
 * SVG is intentionally not accepted (it can carry scripts).
 */
export function sniffImage(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  return null;
}

export type AudioMime = "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/flac" | "audio/mp4" | "audio/webm";

/**
 * Detects audio containers from magic bytes (same idea as sniffImage: the client's
 * MIME type is never trusted). MP3 (ID3 tag or MPEG frame sync), Ogg (Vorbis/Opus),
 * WAV, FLAC, MP4/M4A and WebM.
 */
export function sniffAudio(buf: Buffer): AudioMime | null {
  if (buf.length < 12) return null;
  const ascii = (a: number, b: number) => buf.toString("ascii", a, b);
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  // MPEG audio frame sync: 11 set bits, layer bits != 00.
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0 && (buf[1]! & 0x06) !== 0) return "audio/mpeg";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(4, 8) === "ftyp" && /^(M4A |M4B |mp42|mp41|isom|iso2|dash)$/.test(ascii(8, 12))) return "audio/mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "audio/webm";
  return null;
}

export interface AssetDto {
  id: string;
  kind: AssetKind;
  mime: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  originalName: string;
  url: string;
  createdAt: string;
}

export const assetUrl = (id: string) => `/api/assets/${id}`;

export function toAssetDto(a: AssetRow): AssetDto {
  return {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    width: a.width,
    height: a.height,
    sizeBytes: a.sizeBytes,
    originalName: a.originalName,
    url: assetUrl(a.id),
    createdAt: a.createdAt.toISOString(),
  };
}

export class AssetService {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
    private readonly campaigns: CampaignService,
  ) {}

  async upload(
    user: User,
    input: { kind: AssetKind; campaignId: string | null; data: Buffer; filename: string },
  ): Promise<AssetRow> {
    if (input.campaignId) {
      const m = await this.campaigns.membership(input.campaignId, user.id);
      // Maps are GM material; players may upload token/portrait art for their own characters.
      if (input.kind === "map" && !m.caps.has("map.manage")) throw forbidden("Only the DM can upload maps");
      if (m.role === "spectator") throw forbidden("Spectators can't upload files");
    }
    if (input.data.length === 0) throw badRequest("The file is empty");
    if (input.data.length > MAX_BYTES[input.kind]) {
      throw badRequest(`File is too large (max ${Math.round(MAX_BYTES[input.kind] / 1024 / 1024)} MB for ${input.kind})`);
    }
    let mime: string;
    let width: number | undefined;
    let height: number | undefined;
    if (input.kind === "audio") {
      // Sounds are table-wide DM material.
      if (!input.campaignId) throw badRequest("Audio must belong to a campaign");
      const m = await this.campaigns.membership(input.campaignId, user.id);
      if (!m.caps.has("music.control")) throw forbidden("Only the DM can upload sounds");
      const audio = sniffAudio(input.data);
      if (!audio) throw badRequest("Unsupported audio type. Upload an MP3, OGG, WAV, FLAC, M4A or WEBM file.");
      mime = audio;
    } else {
      const image = sniffImage(input.data);
      if (!image) throw badRequest("Unsupported file type. Upload a PNG, JPG, WEBP or GIF image.");
      mime = image;
      try {
        ({ width, height } = imageSize(input.data));
      } catch {
        throw badRequest("The image file appears to be damaged");
      }
      if (!width || !height) throw badRequest("Couldn't read the image dimensions");
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw badRequest(`Image is too large (max ${MAX_DIMENSION}px on each side)`);
      }
    }

    const id = randomUUID();
    const storageKey = `${input.campaignId ? `c/${input.campaignId}` : `u/${user.id}`}/${id}`;
    await this.storage.put(storageKey, input.data, mime);
    const [row] = await this.db
      .insert(assets)
      .values({
        id,
        ownerId: user.id,
        campaignId: input.campaignId,
        kind: input.kind,
        mime,
        sizeBytes: input.data.length,
        width,
        height,
        storageKey,
        sha256: createHash("sha256").update(input.data).digest("hex"),
        originalName: input.filename.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 120),
      })
      .returning();
    return row!;
  }

  private async row(id: string): Promise<AssetRow> {
    const [row] = await this.db.select().from(assets).where(and(eq(assets.id, id), isNull(assets.deletedAt))).limit(1);
    if (!row) throw notFound("File");
    return row;
  }

  /**
   * Read access: personal assets are readable by any signed-in user who has the id
   * (avatars/portraits appear across campaigns); campaign assets need membership.
   * Returns 404 rather than 403 so ids can't be probed.
   */
  async readable(id: string, userId: string): Promise<AssetRow> {
    const row = await this.row(id);
    if (row.campaignId) {
      const m = await this.campaigns.membership(row.campaignId, userId).catch(() => {
        throw notFound("File");
      });
      // Handout images stay private until a journal entry the viewer can read uses them.
      if (row.kind === "handout" && row.ownerId !== userId && !m.caps.has("journal.manage")) {
        const [shared] = await this.db
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.imageAssetId, row.id),
              or(
                eq(journalEntries.visibility, "all"),
                and(eq(journalEntries.visibility, "selected"), sql`${userId}::uuid = any(${journalEntries.sharedWith})`),
                and(eq(journalEntries.visibility, "author"), eq(journalEntries.authorId, userId)),
              ),
            ),
          )
          .limit(1);
        if (!shared) throw notFound("File");
      }
    }
    return row;
  }

  /** Validates an asset can be used as a campaign map/token image. */
  async requireCampaignAsset(id: string, campaignId: string, userId: string): Promise<AssetRow> {
    const row = await this.row(id);
    if (row.campaignId !== campaignId && !(row.campaignId === null && row.ownerId === userId)) {
      throw badRequest("That image belongs to a different campaign");
    }
    return row;
  }

  async list(campaignId: string, userId: string, kind?: AssetKind): Promise<AssetRow[]> {
    const m = await this.campaigns.membership(campaignId, userId);
    const where = [eq(assets.campaignId, campaignId), isNull(assets.deletedAt)];
    if (kind) where.push(eq(assets.kind, kind));
    if (!m.caps.has("journal.manage")) where.push(or(ne(assets.kind, "handout"), eq(assets.ownerId, userId))!);
    // Sound names can spoil what's coming; players only hear what is played.
    if (!m.caps.has("music.control")) where.push(ne(assets.kind, "audio"));
    return this.db.select().from(assets).where(and(...where)).orderBy(assets.createdAt);
  }

  stream(row: AssetRow, range?: { start: number; end: number }) {
    return this.storage.get(row.storageKey, range);
  }
}
