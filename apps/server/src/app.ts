import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { SESSION_COOKIE, type AppContext } from "./context.js";
import type { Db } from "./db/client.js";
import { AuthService } from "./auth/service.js";
import { CampaignService } from "./campaigns/service.js";
import { CharacterService } from "./characters/service.js";
import { ChatService } from "./chat/service.js";
import { HttpError } from "./lib/errors.js";
import { authRoutes } from "./auth/routes.js";
import { campaignRoutes } from "./campaigns/routes.js";
import { characterRoutes } from "./characters/routes.js";
import { chatRoutes } from "./chat/routes.js";
import { Realtime } from "./realtime/socket.js";
import multipart from "@fastify/multipart";
import { AssetService, MAX_UPLOAD_BYTES } from "./assets/service.js";
import { LocalDiskStorage, type Storage } from "./assets/storage.js";
import { assetRoutes } from "./assets/routes.js";
import { SceneService } from "./scenes/service.js";
import { sceneRoutes } from "./scenes/routes.js";

export async function buildApp(
  config: Config,
  db: Db,
  opts: { realtime?: boolean; storage?: Storage } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.NODE_ENV === "production" ? "info" : "debug" },
    trustProxy: config.NODE_ENV === "production",
    bodyLimit: 512 * 1024,
  });

  const auth = new AuthService(db, { sessionTtlDays: config.SESSION_TTL_DAYS, guestTtlDays: config.GUEST_TTL_DAYS });
  const campaigns = new CampaignService(db);
  const assets = new AssetService(db, opts.storage ?? new LocalDiskStorage(path.resolve(config.UPLOAD_DIR)), campaigns);
  const ctx: AppContext = {
    config,
    db,
    auth,
    campaigns,
    characters: new CharacterService(db, campaigns),
    chat: new ChatService(db, campaigns, () => ctx.realtime),
    assets,
    scenes: new SceneService(db, campaigns, assets),
  };
  app.decorate("ctx", ctx);
  app.decorateRequest("auth", null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  if (config.RATE_LIMIT === "on") {
    await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  }

  // Security headers for every response.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; frame-ancestors 'none'",
    );
  });

  // CSRF defence: state-changing requests must come from our own origin (cookies are SameSite=Lax too).
  app.addHook("onRequest", async (req) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    if (origin && origin !== config.WEB_ORIGIN && origin !== `${req.protocol}://${req.headers.host}`) {
      throw new HttpError(403, "bad_origin", "Cross-origin request blocked");
    }
  });

  app.addHook("preHandler", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.auth = await auth.resolveSession(token);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? "bad_request", message: e.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "internal", message: "Something went wrong on our side" } });
  });

  app.get("/api/health", async () => {
    await db.execute("select 1");
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(campaignRoutes);
  await app.register(characterRoutes);
  await app.register(chatRoutes);
  await app.register(assetRoutes);
  await app.register(sceneRoutes);

  if (config.WEB_DIST && existsSync(config.WEB_DIST)) {
    await app.register(fastifyStatic, { root: path.resolve(config.WEB_DIST) });
    // SPA fallback for client-side routes.
    app.setNotFoundHandler((req, reply) => {
      // Missing API routes and static assets are real 404s; everything else is a client route.
      if (req.url.startsWith("/api/") || req.url.startsWith("/socket.io") || req.url.startsWith("/assets/")) {
        return reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "Not found" } }));
  }

  if (opts.realtime !== false) {
    ctx.realtime = new Realtime(app, ctx);
    app.addHook("preClose", async () => {
      ctx.realtime?.io.disconnectSockets(true);
    });
  }
  return app;
}
