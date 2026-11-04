import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  canSeeChatMessage,
  isGameMaster,
  roll,
  rollViewFor,
  DiceSyntaxError,
  type CampaignRole,
  type ChatChannel,
  type RollMode,
  type RollResult,
  type RollVisibility,
  type Viewer,
} from "@vtt/rules";
import type { Db } from "../db/client.js";
import { characters, chatMessages, diceRolls, gameSessions, users, type ChatMessageRow, type DiceRollRow } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import type { CampaignService, Membership } from "../campaigns/service.js";

export const MAX_CHAT_LENGTH = 2000;

export interface ChatMessageDto {
  type: "chat";
  id: string;
  campaignId: string;
  senderId: string | null;
  senderName: string | null;
  characterId: string | null;
  characterName: string | null;
  channel: ChatChannel;
  recipientIds: string[];
  content: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface RollDto {
  type: "roll";
  id: string;
  campaignId: string;
  userId: string;
  userName: string;
  characterId: string | null;
  characterName: string | null;
  label: string;
  rollType: string;
  visibility: RollVisibility;
  recipientIds: string[];
  createdAt: string;
  /** Present only when the viewer may see the result. */
  formula?: string;
  total?: number;
  result?: RollResult;
  redacted: boolean;
}

export function viewerFor(userId: string, role: CampaignRole): Viewer {
  return { userId, isGameMaster: isGameMaster(role), isSpectator: role === "spectator" };
}

/** Shapes a roll for one viewer, or null if they may not see it at all. */
export function rollForViewer(dto: Required<Omit<RollDto, "redacted">> & { redacted?: boolean }, viewer: Viewer): RollDto | null {
  const view = rollViewFor(dto.visibility, { authorId: dto.userId, recipientIds: dto.recipientIds }, viewer);
  if (view === "none") return null;
  if (view === "full") return { ...dto, redacted: false };
  const { formula: _f, total: _t, result: _r, ...rest } = dto;
  return { ...rest, redacted: true };
}

type Realtime = { broadcastChat(msg: ChatMessageDto): void; broadcastRoll(roll: Required<Omit<RollDto, "redacted">>): void };

export class ChatService {
  constructor(
    private readonly db: Db,
    private readonly campaigns: CampaignService,
    private readonly realtime: () => Realtime | undefined,
  ) {}

  private async names(userId: string | null, characterId: string | null) {
    const [u] = userId ? await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, userId)) : [];
    const [c] = characterId
      ? await this.db.select({ n: characters.name }).from(characters).where(eq(characters.id, characterId))
      : [];
    return { senderName: u?.n ?? null, characterName: c?.n ?? null };
  }

  private toDto(row: ChatMessageRow, senderName: string | null, characterName: string | null): ChatMessageDto {
    return {
      type: "chat",
      id: row.id,
      campaignId: row.campaignId,
      senderId: row.senderId,
      senderName,
      characterId: row.characterId,
      characterName,
      channel: row.channel,
      recipientIds: row.recipientIds,
      content: row.deletedAt ? "" : row.content,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      deleted: !!row.deletedAt,
    };
  }

  /** The member's active character, used to speak "in character". */
  private async speakingAs(m: Membership, characterId: string | null | undefined): Promise<string | null> {
    if (!characterId) return null;
    if (characterId === m.member.activeCharacterId) return characterId;
    if (m.caps.has("npc.manage")) {
      const [c] = await this.db
        .select({ id: characters.id })
        .from(characters)
        .where(and(eq(characters.id, characterId), eq(characters.campaignId, m.campaign.id), isNull(characters.deletedAt)));
      if (c) return c.id;
    }
    throw badRequest("You can't speak as that character");
  }

  private async validateRecipients(m: Membership, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)].filter((id) => id !== m.member.userId);
    const found = await this.campaigns.membersByIds(m.campaign.id, unique);
    if (found.length !== unique.length) throw badRequest("All recipients must be members of this campaign");
    return unique;
  }

  async send(
    m: Membership,
    input: { channel: Exclude<ChatChannel, "system">; content: string; recipientIds: string[]; characterId?: string | null },
  ): Promise<ChatMessageDto> {
    if (!m.caps.has("chat.send")) throw forbidden("Your role can't send messages");
    const content = input.content.trim();
    if (!content) throw badRequest("Message is empty");
    if (content.length > MAX_CHAT_LENGTH) throw badRequest(`Message is too long (max ${MAX_CHAT_LENGTH})`);
    let recipientIds: string[] = [];
    if (input.channel === "whisper") {
      if (!m.caps.has("chat.whisper")) throw forbidden("Your role can't whisper");
      recipientIds = await this.validateRecipients(m, input.recipientIds);
      if (recipientIds.length === 0) throw badRequest("Choose who to whisper to");
    }
    if (input.channel === "party" && m.role === "spectator") throw forbidden("Spectators can't use party chat");
    const characterId = await this.speakingAs(m, input.characterId);
    const [row] = await this.db
      .insert(chatMessages)
      .values({ campaignId: m.campaign.id, senderId: m.member.userId, characterId, channel: input.channel, recipientIds, content })
      .returning();
    const { senderName, characterName } = await this.names(m.member.userId, characterId);
    const dto = this.toDto(row!, senderName, characterName);
    this.realtime()?.broadcastChat(dto);
    return dto;
  }

  async system(campaignId: string, content: string): Promise<ChatMessageDto> {
    const [row] = await this.db
      .insert(chatMessages)
      .values({ campaignId, channel: "system", content: content.slice(0, MAX_CHAT_LENGTH) })
      .returning();
    const dto = this.toDto(row!, null, null);
    this.realtime()?.broadcastChat(dto);
    return dto;
  }

  async edit(m: Membership, messageId: string, content: string): Promise<ChatMessageDto> {
    const text = content.trim();
    if (!text || text.length > MAX_CHAT_LENGTH) throw badRequest("Invalid message");
    const [row] = await this.db
      .update(chatMessages)
      .set({ content: text, editedAt: new Date() })
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chatMessages.campaignId, m.campaign.id),
          eq(chatMessages.senderId, m.member.userId),
          isNull(chatMessages.deletedAt),
        ),
      )
      .returning();
    if (!row) throw notFound("Message");
    const { senderName, characterName } = await this.names(row.senderId, row.characterId);
    const dto = this.toDto(row, senderName, characterName);
    this.realtime()?.broadcastChat(dto);
    return dto;
  }

  async remove(m: Membership, messageId: string): Promise<ChatMessageDto> {
    const [existing] = await this.db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.campaignId, m.campaign.id), isNull(chatMessages.deletedAt)));
    if (!existing) throw notFound("Message");
    const isAuthor = existing.senderId === m.member.userId;
    if (!isAuthor && !m.caps.has("chat.moderate")) throw forbidden();
    // Moderators may only delete messages they could see (not private whispers between others).
    if (!isAuthor && !canSeeChatMessage(existing.channel, { authorId: existing.senderId ?? "", recipientIds: existing.recipientIds }, viewerFor(m.member.userId, m.role))) {
      throw notFound("Message");
    }
    const [row] = await this.db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, messageId)).returning();
    const dto = this.toDto(row!, null, null);
    this.realtime()?.broadcastChat(dto);
    return dto;
  }

  /** SQL filter equivalent of canSeeChatMessage, so hidden messages never leave the database. */
  private visibleChatWhere(viewer: Viewer) {
    const me = viewer.userId;
    const conds = [
      sql`${chatMessages.channel} in ('global','system')`,
      sql`${chatMessages.channel} = 'whisper' and (${chatMessages.senderId} = ${me} or ${me} = any(${chatMessages.recipientIds}))`,
    ];
    if (viewer.isGameMaster) conds.push(sql`${chatMessages.channel} in ('party','dm')`);
    else {
      conds.push(sql`${chatMessages.channel} = 'dm' and ${chatMessages.senderId} = ${me}`);
      conds.push(
        viewer.isSpectator
          ? sql`${chatMessages.channel} = 'party' and ${chatMessages.senderId} = ${me}`
          : sql`${chatMessages.channel} = 'party'`,
      );
    }
    return or(...conds);
  }

  async history(m: Membership, opts: { before?: Date; limit: number }): Promise<ChatMessageDto[]> {
    const viewer = viewerFor(m.member.userId, m.role);
    const rows = await this.db
      .select({ msg: chatMessages, senderName: users.displayName, characterName: characters.name })
      .from(chatMessages)
      .leftJoin(users, eq(users.id, chatMessages.senderId))
      .leftJoin(characters, eq(characters.id, chatMessages.characterId))
      .where(
        and(
          eq(chatMessages.campaignId, m.campaign.id),
          this.visibleChatWhere(viewer),
          opts.before ? lt(chatMessages.createdAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(opts.limit);
    return rows.reverse().map((r) => this.toDto(r.msg, r.senderName, r.characterName));
  }

  // ---- Dice --------------------------------------------------------------

  async roll(
    m: Membership,
    input: {
      formula: string;
      mode: RollMode;
      visibility: RollVisibility;
      recipientIds: string[];
      label: string;
      rollType: string;
      characterId?: string | null;
    },
  ): Promise<Required<Omit<RollDto, "redacted">>> {
    if (!m.caps.has("dice.roll")) throw forbidden("Your role can't roll dice");
    if (input.visibility === "dm_only" && !m.caps.has("dice.rollHidden")) {
      throw forbidden("Only DMs can make hidden rolls");
    }
    const recipientIds = input.visibility === "whisper" ? await this.validateRecipients(m, input.recipientIds) : [];
    if (input.visibility === "whisper" && recipientIds.length === 0) throw badRequest("Choose who to whisper the roll to");
    const characterId = await this.speakingAs(m, input.characterId);

    let result: RollResult;
    try {
      result = roll(input.formula, { mode: input.mode });
    } catch (e) {
      if (e instanceof DiceSyntaxError || e instanceof RangeError) throw badRequest(e.message);
      throw e;
    }
    const [session] = await this.db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(and(eq(gameSessions.campaignId, m.campaign.id), sql`${gameSessions.status} <> 'ended'`));
    const [row] = await this.db
      .insert(diceRolls)
      .values({
        campaignId: m.campaign.id,
        userId: m.member.userId,
        characterId,
        gameSessionId: session?.id ?? null,
        formula: result.normalized,
        label: input.label,
        rollType: input.rollType,
        visibility: input.visibility,
        recipientIds,
        total: result.total,
        result,
      })
      .returning();
    const { senderName, characterName } = await this.names(m.member.userId, characterId);
    const dto = this.rollDto(row!, senderName ?? "", characterName);
    this.realtime()?.broadcastRoll(dto);
    return dto;
  }

  private rollDto(row: DiceRollRow, userName: string, characterName: string | null): Required<Omit<RollDto, "redacted">> {
    return {
      type: "roll",
      id: row.id,
      campaignId: row.campaignId,
      userId: row.userId,
      userName,
      characterId: row.characterId,
      characterName,
      label: row.label,
      rollType: row.rollType,
      visibility: row.visibility,
      recipientIds: row.recipientIds,
      createdAt: row.createdAt.toISOString(),
      formula: row.formula,
      total: row.total,
      result: row.result,
    };
  }

  async rollHistory(m: Membership, opts: { before?: Date; limit: number }): Promise<RollDto[]> {
    const viewer = viewerFor(m.member.userId, m.role);
    const me = viewer.userId;
    const visible = viewer.isGameMaster
      ? undefined
      : or(
          sql`${diceRolls.visibility} = 'public'`,
          sql`${diceRolls.visibility} in ('private','blind') and ${diceRolls.userId} = ${me}`,
          sql`${diceRolls.visibility} = 'whisper' and (${diceRolls.userId} = ${me} or ${me} = any(${diceRolls.recipientIds}))`,
        );
    const rows = await this.db
      .select({ roll: diceRolls, userName: users.displayName, characterName: characters.name })
      .from(diceRolls)
      .innerJoin(users, eq(users.id, diceRolls.userId))
      .leftJoin(characters, eq(characters.id, diceRolls.characterId))
      .where(and(eq(diceRolls.campaignId, m.campaign.id), visible, opts.before ? lt(diceRolls.createdAt, opts.before) : undefined))
      .orderBy(desc(diceRolls.createdAt))
      .limit(opts.limit);
    return rows
      .reverse()
      .map((r) => rollForViewer(this.rollDto(r.roll, r.userName, r.characterName), viewer))
      .filter((r): r is RollDto => r !== null);
  }
}
