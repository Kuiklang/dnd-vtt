import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import { authSessions, users, type User } from "../db/schema.js";
import { hashPassword, newSessionToken, sha256, verifyPassword } from "../lib/crypto.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";

export const GUEST_LIMITS = { maxCharacters: 5, canCreateCampaigns: false } as const;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

export interface SelfUser extends PublicUser {
  email: string | null;
  guestExpiresAt: string | null;
  settings: Record<string, unknown>;
}

export function toPublicUser(u: Pick<User, "id" | "username" | "displayName" | "avatarUrl" | "isGuest">): PublicUser {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, isGuest: u.isGuest };
}

export function toSelfUser(u: User): SelfUser {
  return {
    ...toPublicUser(u),
    email: u.email,
    guestExpiresAt: u.guestExpiresAt?.toISOString() ?? null,
    settings: u.settings,
  };
}

// A real hash of a random password, used to keep login timing uniform when the user doesn't exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly opts: { sessionTtlDays: number; guestTtlDays: number },
  ) {}

  private async assertAvailable(email: string | null, username: string, exceptUserId?: string) {
    const conds = [sql`lower(${users.username}) = lower(${username})`];
    if (email) conds.push(sql`lower(${users.email}) = lower(${email})`);
    const rows = await this.db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(or(...conds));
    for (const r of rows) {
      if (r.id === exceptUserId) continue;
      if (r.username.toLowerCase() === username.toLowerCase()) throw conflict("That username is taken");
      if (email && r.email?.toLowerCase() === email.toLowerCase()) throw conflict("That email is already registered");
    }
  }

  async register(input: { email: string; username: string; password: string; displayName?: string }): Promise<User> {
    await this.assertAvailable(input.email, input.username);
    const passwordHash = await hashPassword(input.password);
    try {
      const [user] = await this.db
        .insert(users)
        .values({
          email: input.email,
          username: input.username,
          displayName: input.displayName || input.username,
          passwordHash,
        })
        .returning();
      return user!;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("That username or email is already registered");
      throw e;
    }
  }

  async createGuest(displayName: string): Promise<User> {
    const expires = new Date(Date.now() + this.opts.guestTtlDays * 86400_000);
    const [user] = await this.db
      .insert(users)
      .values({
        username: `guest-${randomBytes(5).toString("hex")}`,
        displayName,
        isGuest: true,
        guestExpiresAt: expires,
      })
      .returning();
    return user!;
  }

  async upgradeGuest(userId: string, input: { email: string; username: string; password: string }): Promise<User> {
    const [current] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!current?.isGuest) throw badRequest("Only guest accounts can be upgraded");
    await this.assertAvailable(input.email, input.username, userId);
    const passwordHash = await hashPassword(input.password);
    const [user] = await this.db
      .update(users)
      .set({
        email: input.email,
        username: input.username,
        passwordHash,
        isGuest: false,
        guestExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user!;
  }

  async verifyCredentials(identifier: string, password: string): Promise<User> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(
        or(
          sql`lower(${users.email}) = lower(${identifier})`,
          sql`lower(${users.username}) = lower(${identifier})`,
        ),
      )
      .limit(1);
    const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !user.passwordHash || !ok) throw unauthorized("Incorrect username/email or password");
    return user;
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
      throw unauthorized("Current password is incorrect");
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async createSession(user: User, meta: { userAgent?: string; ip?: string }): Promise<{ token: string; expiresAt: Date }> {
    const token = newSessionToken();
    const ttlDays = user.isGuest ? this.opts.guestTtlDays : this.opts.sessionTtlDays;
    let expiresAt = new Date(Date.now() + ttlDays * 86400_000);
    if (user.guestExpiresAt && user.guestExpiresAt < expiresAt) expiresAt = user.guestExpiresAt;
    await this.db.insert(authSessions).values({
      userId: user.id,
      tokenHash: sha256(token),
      userAgent: meta.userAgent?.slice(0, 300),
      ip: meta.ip,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Resolves a raw session token to its user, or null if invalid/expired/revoked. */
  async resolveSession(token: string): Promise<{ user: User; sessionId: string } | null> {
    if (!token || token.length > 100) return null;
    const now = new Date();
    const [row] = await this.db
      .select({ session: authSessions, user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.tokenHash, sha256(token)), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)))
      .limit(1);
    if (!row) return null;
    if (row.user.isGuest && row.user.guestExpiresAt && row.user.guestExpiresAt < now) return null;
    // Throttle last-used writes to once a minute.
    if (now.getTime() - row.session.lastUsedAt.getTime() > 60_000) {
      await this.db.update(authSessions).set({ lastUsedAt: now }).where(eq(authSessions.id, row.session.id));
    }
    return { user: row.user, sessionId: row.session.id };
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)));
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          exceptSessionId ? ne(authSessions.id, exceptSessionId) : undefined,
        ),
      );
  }

  async listSessions(userId: string) {
    return this.db
      .select({
        id: authSessions.id,
        userAgent: authSessions.userAgent,
        createdAt: authSessions.createdAt,
        lastUsedAt: authSessions.lastUsedAt,
        expiresAt: authSessions.expiresAt,
      })
      .from(authSessions)
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())));
  }

  async updateProfile(
    userId: string,
    patch: { displayName?: string; avatarUrl?: string | null; settings?: Record<string, unknown> },
  ): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user!;
  }
}

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
