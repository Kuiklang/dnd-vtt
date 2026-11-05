import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/routes.js";
import { badRequest } from "../lib/errors.js";
import { MAX_PACK_BYTES } from "./service.js";

export async function packRoutes(app: FastifyInstance) {
  /** Multipart upload of one campaign pack (.zip); creates a new campaign owned by the caller. */
  app.post("/api/campaigns/import", async (req, reply) => {
    const { user } = requireAuth(req);
    if (!req.isMultipart()) throw badRequest("Send the pack as multipart/form-data");
    let zip: Buffer | null = null;
    for await (const part of req.parts({ limits: { fileSize: MAX_PACK_BYTES, files: 1, fields: 2 } })) {
      if (part.type === "file") {
        zip = await part.toBuffer();
        if (part.file.truncated) throw badRequest(`The pack is too large (max ${MAX_PACK_BYTES / 1024 / 1024} MB)`);
      }
    }
    if (!zip) throw badRequest("No file was uploaded");
    const summary = await app.ctx.packs.import(user, zip);
    return reply.code(201).send({ summary });
  });
}
