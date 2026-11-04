import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE, type RequestAuth } from "../context.js";
import type { User } from "../db/schema.js";
import { unauthorized } from "../lib/errors.js";
import { cleanText, httpsUrl, idParams, parse } from "../lib/validation.js";
import { toSelfUser } from "./service.js";

const username = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(24)
  .regex(/^[a-zA-Z0-9_.-]+$/, "Username may contain letters, numbers, _ . -")
  .refine((u) => !u.toLowerCase().startsWith("guest-"), "Usernames starting with 'guest-' are reserved");
const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email");
const password = z.string().min(8, "Password must be at least 8 characters").max(200);
const displayName = cleanText(40).pipe(z.string().min(1, "Display name is required"));

export function requireAuth(req: FastifyRequest): RequestAuth {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export async function authRoutes(app: FastifyInstance) {
  const { auth, config } = app.ctx;

  const setSessionCookie = async (reply: FastifyReply, req: FastifyRequest, user: User) => {
    const { token, expiresAt } = await auth.createSession(user, {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.COOKIE_SECURE || req.protocol === "https",
      path: "/",
      expires: expiresAt,
    });
  };

  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/api/auth/register", strict, async (req, reply) => {
    const body = parse(
      z.object({ email, username, password, displayName: displayName.optional() }),
      req.body,
    );
    const user = await auth.register(body);
    await setSessionCookie(reply, req, user);
    return reply.code(201).send({ user: toSelfUser(user) });
  });

  app.post("/api/auth/login", strict, async (req, reply) => {
    const body = parse(z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().max(200) }), req.body);
    const user = await auth.verifyCredentials(body.identifier, body.password);
    await setSessionCookie(reply, req, user);
    return { user: toSelfUser(user) };
  });

  app.post("/api/auth/guest", strict, async (req, reply) => {
    const body = parse(z.object({ displayName }), req.body);
    const user = await auth.createGuest(body.displayName);
    await setSessionCookie(reply, req, user);
    return reply.code(201).send({ user: toSelfUser(user) });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.auth) await auth.revokeSession(req.auth.sessionId, req.auth.user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    return { user: req.auth ? toSelfUser(req.auth.user) : null };
  });

  app.patch("/api/me", async (req) => {
    const { user } = requireAuth(req);
    const body = parse(
      z
        .object({
          displayName: displayName.optional(),
          avatarUrl: z.union([httpsUrl, z.literal(""), z.null()]).optional(),
          settings: z
            .object({
              diceAnimation: z.boolean().optional(),
              diceSound: z.boolean().optional(),
              defaultRollVisibility: z.enum(["public", "private", "dm_only", "whisper", "blind"]).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      req.body,
    );
    const updated = await auth.updateProfile(user.id, {
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl || null } : {}),
      ...(body.settings ? { settings: { ...user.settings, ...body.settings } } : {}),
    });
    app.ctx.realtime?.refreshUser(updated.id);
    return { user: toSelfUser(updated) };
  });

  app.post("/api/me/password", strict, async (req) => {
    const { user, sessionId } = requireAuth(req);
    const body = parse(z.object({ currentPassword: z.string().max(200), newPassword: password }), req.body);
    await auth.changePassword(user.id, body.currentPassword, body.newPassword);
    await auth.revokeAllSessions(user.id, sessionId);
    return { ok: true };
  });

  app.post("/api/me/upgrade", strict, async (req) => {
    const { user } = requireAuth(req);
    const body = parse(z.object({ email, username, password }), req.body);
    const updated = await auth.upgradeGuest(user.id, body);
    return { user: toSelfUser(updated) };
  });

  app.get("/api/me/sessions", async (req) => {
    const { user, sessionId } = requireAuth(req);
    const sessions = await auth.listSessions(user.id);
    return { sessions: sessions.map((s) => ({ ...s, current: s.id === sessionId })) };
  });

  app.delete("/api/me/sessions/:id", async (req) => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await auth.revokeSession(id, user.id);
    return { ok: true };
  });

  app.post("/api/me/sessions/revoke-others", async (req) => {
    const { user, sessionId } = requireAuth(req);
    await auth.revokeAllSessions(user.id, sessionId);
    return { ok: true };
  });
}
