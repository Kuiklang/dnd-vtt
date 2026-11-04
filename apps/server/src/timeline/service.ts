import { and, asc, eq, gte, lte, max } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  characters,
  chatMessages,
  diceRolls,
  gameSessions,
  timelineEvents,
  users,
  type GameSessionRow,
  type TimelineEventRow,
} from "../db/schema.js";
import type { Membership } from "../campaigns/service.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";

export interface SessionSummaryDto {
  id: string;
  number: number;
  name: string;
  status: GameSessionRow["status"];
  startedAt: string;
  endedAt: string | null;
  /** Empty for players until the DM publishes it. */
  recap: string;
  recapPublished: boolean;
}

export interface TimelineEventDto {
  id: string;
  sessionId: string | null;
  title: string;
  body: string;
  inWorldDate: string;
  sortKey: number;
  /** Only sent to the DM (players only ever receive "players" events). */
  visibility?: TimelineEventRow["visibility"];
  createdAt: string;
}

export interface TimelineEventInput {
  title: string;
  body?: string;
  inWorldDate?: string;
  sessionId?: string | null;
  visibility?: TimelineEventRow["visibility"];
  sortKey?: number;
}

const MAX_EVENTS = 1000;

/** Notices worth keeping in a recap (the rest is table chatter or bookkeeping). */
const NOTICE_SKIP = [
  / joined the campaign\.?$/,
  / left the campaign\.?$/,
  / is paused\.?$/,
];

export interface RecapSource {
  session: {
    number: number;
    name: string;
    startedAt: Date;
    endedAt: Date | null;
  };
  /** Public log notices in order (casts, hand-offs, session start/end, concentration...). */
  notices: string[];
  /** Public rolls in the session. */
  rolls: Array<{
    who: string;
    label: string;
    total: number;
    rollType: string;
    critical: boolean;
    fumble: boolean;
  }>;
}

/**
 * Builds an editable recap draft from what happened in the public log. Pure, so the
 * wording can be tested; nothing DM-only goes in (the DM may publish it as is).
 */
export function draftRecap(src: RecapSource): string {
  const { session } = src;
  const lines: string[] = [
    `Session ${session.number}: ${session.name}`,
    `Played ${session.startedAt.toISOString().slice(0, 10)}`,
    "",
  ];
  const notices = src.notices.filter(
    (n) => !NOTICE_SKIP.some((r) => r.test(n)),
  );
  if (notices.length) {
    lines.push("What happened:");
    for (const n of notices.slice(0, 60))
      lines.push(`- ${n.replace(/\.$/, "")}`);
    if (notices.length > 60) lines.push(`- …and ${notices.length - 60} more`);
    lines.push("");
  }
  if (src.rolls.length) {
    const byWho = new Map<string, number>();
    for (const r of src.rolls) byWho.set(r.who, (byWho.get(r.who) ?? 0) + 1);
    const crits = src.rolls.filter((r) => r.critical);
    const fumbles = src.rolls.filter((r) => r.fumble);
    const damage = src.rolls
      .filter((r) => r.rollType === "damage")
      .sort((a, b) => b.total - a.total)[0];
    lines.push("Dice:");
    lines.push(
      `- ${src.rolls.length} rolls: ${[...byWho]
        .sort((a, b) => b[1] - a[1])
        .map(([w, n]) => `${w} ${n}`)
        .join(", ")}`,
    );
    if (damage)
      lines.push(
        `- Biggest hit: ${damage.total} (${damage.label || "damage"}, ${damage.who})`,
      );
    if (crits.length)
      lines.push(
        `- Natural 20s: ${crits.map((r) => `${r.who}${r.label ? ` (${r.label})` : ""}`).join(", ")}`,
      );
    if (fumbles.length)
      lines.push(
        `- Natural 1s: ${fumbles.map((r) => `${r.who}${r.label ? ` (${r.label})` : ""}`).join(", ")}`,
      );
    lines.push("");
  }
  if (!notices.length && !src.rolls.length)
    lines.push(
      "Nothing was logged in this session yet. Write what happened here.",
      "",
    );
  lines.push("Notes:", "- ");
  return lines.join("\n");
}

/** Session recaps and the campaign timeline (Phase 7). */
export class TimelineService {
  constructor(private readonly db: Db) {}

  private isDm(m: Membership) {
    return m.caps.has("session.control");
  }

  private toSession(r: GameSessionRow, dm: boolean): SessionSummaryDto {
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      recap: dm || r.recapPublished ? r.recap : "",
      recapPublished: r.recapPublished,
    };
  }

  private toEvent(r: TimelineEventRow, dm: boolean): TimelineEventDto {
    return {
      id: r.id,
      sessionId: r.sessionId,
      title: r.title,
      body: r.body,
      inWorldDate: r.inWorldDate,
      sortKey: r.sortKey,
      ...(dm ? { visibility: r.visibility } : {}),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async timeline(
    m: Membership,
  ): Promise<{ sessions: SessionSummaryDto[]; events: TimelineEventDto[] }> {
    const dm = this.isDm(m);
    const [sessions, events] = await Promise.all([
      this.db
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.campaignId, m.campaign.id))
        .orderBy(asc(gameSessions.number)),
      this.db
        .select()
        .from(timelineEvents)
        .where(
          dm
            ? eq(timelineEvents.campaignId, m.campaign.id)
            : and(
                eq(timelineEvents.campaignId, m.campaign.id),
                eq(timelineEvents.visibility, "players"),
              ),
        )
        .orderBy(asc(timelineEvents.sortKey), asc(timelineEvents.createdAt)),
    ]);
    return {
      sessions: sessions.map((s) => this.toSession(s, dm)),
      events: events.map((e) => this.toEvent(e, dm)),
    };
  }

  private async session(
    m: Membership,
    sessionId: string,
  ): Promise<GameSessionRow> {
    const [s] = await this.db
      .select()
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.id, sessionId),
          eq(gameSessions.campaignId, m.campaign.id),
        ),
      );
    if (!s) throw notFound("Session");
    return s;
  }

  /** A recap draft from the session's public log notices and rolls (DM only). */
  async recapDraft(m: Membership, sessionId: string): Promise<string> {
    if (!this.isDm(m)) throw forbidden("Only the DM writes recaps");
    const s = await this.session(m, sessionId);
    // The "session has ended" notice is posted just after endedAt is stamped.
    const until = s.endedAt
      ? new Date(s.endedAt.getTime() + 60_000)
      : new Date();
    const [notices, rolls] = await Promise.all([
      this.db
        .select({ content: chatMessages.content })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.campaignId, m.campaign.id),
            eq(chatMessages.channel, "system"),
            gte(chatMessages.createdAt, s.startedAt),
            lte(chatMessages.createdAt, until),
          ),
        )
        .orderBy(asc(chatMessages.createdAt))
        .limit(500),
      this.db
        .select({
          label: diceRolls.label,
          total: diceRolls.total,
          rollType: diceRolls.rollType,
          result: diceRolls.result,
          character: characters.name,
          user: users.displayName,
        })
        .from(diceRolls)
        .innerJoin(users, eq(users.id, diceRolls.userId))
        .leftJoin(characters, eq(characters.id, diceRolls.characterId))
        .where(
          and(
            eq(diceRolls.campaignId, m.campaign.id),
            eq(diceRolls.gameSessionId, s.id),
            eq(diceRolls.visibility, "public"),
          ),
        )
        .orderBy(asc(diceRolls.createdAt))
        .limit(2000),
    ]);
    return draftRecap({
      session: s,
      notices: notices.map((n) => n.content),
      rolls: rolls.map((r) => {
        const who = r.character ?? r.user;
        // Token rolls prefix the roller's name ("Elara — Dex save"); keep just the action.
        const label = r.label.startsWith(`${who} — `)
          ? r.label.slice(who.length + 3)
          : r.label;
        return {
          who,
          label,
          total: r.total,
          rollType: r.rollType,
          critical: r.result.critical,
          fumble: r.result.fumble,
        };
      }),
    });
  }

  async updateRecap(
    m: Membership,
    sessionId: string,
    patch: { recap?: string; recapPublished?: boolean },
  ): Promise<SessionSummaryDto> {
    if (!this.isDm(m)) throw forbidden("Only the DM writes recaps");
    await this.session(m, sessionId);
    const [row] = await this.db
      .update(gameSessions)
      .set(patch)
      .where(eq(gameSessions.id, sessionId))
      .returning();
    return this.toSession(row!, true);
  }

  private async checkSession(
    m: Membership,
    sessionId: string | null | undefined,
  ) {
    if (sessionId) await this.session(m, sessionId);
  }

  async createEvent(
    m: Membership,
    input: TimelineEventInput,
  ): Promise<TimelineEventDto> {
    if (!m.caps.has("journal.manage"))
      throw forbidden("Only the DM edits the timeline");
    await this.checkSession(m, input.sessionId);
    const [last] = await this.db
      .select({ top: max(timelineEvents.sortKey) })
      .from(timelineEvents)
      .where(eq(timelineEvents.campaignId, m.campaign.id));
    const top = last?.top ?? 0;
    const total = await this.db.$count(
      timelineEvents,
      eq(timelineEvents.campaignId, m.campaign.id),
    );
    if (total >= MAX_EVENTS)
      throw badRequest(`A timeline holds at most ${MAX_EVENTS} events`);
    const [row] = await this.db
      .insert(timelineEvents)
      .values({
        campaignId: m.campaign.id,
        sessionId: input.sessionId ?? null,
        title: input.title,
        body: input.body ?? "",
        inWorldDate: input.inWorldDate ?? "",
        visibility: input.visibility ?? "players",
        sortKey: input.sortKey ?? top + 10,
        createdBy: m.member.userId,
      })
      .returning();
    return this.toEvent(row!, true);
  }

  async updateEvent(
    m: Membership,
    eventId: string,
    patch: Partial<TimelineEventInput>,
  ): Promise<TimelineEventDto> {
    if (!m.caps.has("journal.manage"))
      throw forbidden("Only the DM edits the timeline");
    await this.checkSession(m, patch.sessionId);
    const [row] = await this.db
      .update(timelineEvents)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(timelineEvents.id, eventId),
          eq(timelineEvents.campaignId, m.campaign.id),
        ),
      )
      .returning();
    if (!row) throw notFound("Timeline event");
    return this.toEvent(row, true);
  }

  async deleteEvent(m: Membership, eventId: string): Promise<void> {
    if (!m.caps.has("journal.manage"))
      throw forbidden("Only the DM edits the timeline");
    const rows = await this.db
      .delete(timelineEvents)
      .where(
        and(
          eq(timelineEvents.id, eventId),
          eq(timelineEvents.campaignId, m.campaign.id),
        ),
      )
      .returning({ id: timelineEvents.id });
    if (!rows.length) throw notFound("Timeline event");
  }
}
