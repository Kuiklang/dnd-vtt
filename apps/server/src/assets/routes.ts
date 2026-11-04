import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/routes.js";
import { badRequest } from "../lib/errors.js";
import { idParams, parse } from "../lib/validation.js";
import { ASSET_KINDS, MAX_UPLOAD_BYTES, toAssetDto, type AssetKind } from "./service.js";

export async function assetRoutes(app: FastifyInstance) {
  const { assets } = app.ctx;

  /** Multipart upload: fields `kind`, optional `campaignId`, then one `file`. */
  app.post("/api/assets", async (req, reply) => {
    const { user } = requireAuth(req);
    if (!req.isMultipart()) throw badRequest("Send the file as multipart/form-data");
    let kind: AssetKind = "other";
    let campaignId: string | null = null;
    let file: { data: Buffer; filename: string } | null = null;
    for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } })) {
      if (part.type === "file") {
        const data = await part.toBuffer();
        if (part.file.truncated) throw badRequest("File is too large");
        file = { data, filename: part.filename ?? "" };
      } else if (part.fieldname === "kind") {
        kind = parse(z.enum(ASSET_KINDS), part.value);
      } else if (part.fieldname === "campaignId") {
        campaignId = part.value ? parse(z.uuid(), part.value) : null;
      }
    }
    if (!file) throw badRequest("No file was uploaded");
    const row = await assets.upload(user, { kind, campaignId, ...file });
    return reply.code(201).send({ asset: toAssetDto(row) });
  });

  app.get("/api/campaigns/:id/assets", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const { kind } = parse(z.object({ kind: z.enum(ASSET_KINDS).optional() }), req.query);
    return { assets: (await assets.list(id, user.id, kind)).map(toAssetDto) };
  });

  app.get("/api/assets/:id", async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const row = await assets.readable(id, user.id);
    const file = await assets.stream(row);
    if (!file) return reply.code(404).send({ error: { code: "not_found", message: "File missing from storage" } });
    // Content is immutable per id; private because access is permission-checked.
    return reply
      .header("content-type", row.mime)
      .header("content-length", file.size)
      .header("cache-control", "private, max-age=31536000, immutable")
      .header("content-disposition", "inline")
      .send(file.stream);
  });
}
