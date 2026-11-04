import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  real,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ActionEconomy, CharacterData, Defenses, FogShape, GridSettings, HpState, RollResult, TokenCondition } from "@vtt/rules";


/*
 * Phase 1 schema. Conventions:
 *  - UUID primary keys (gen_random_uuid), timestamptz everywhere.
 *  - Soft delete via deleted_at for user content; queries filter on it.
 *  - Every campaign-scoped table carries campaign_id with a FK + index (tenant isolation).
 *  - JSONB only for genuinely flexible, schema-validated documents (character sheet,
 *    roll breakdown, settings); relational facts stay in columns.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const campaignRole = pgEnum("campaign_role", ["owner", "dm", "co_dm", "player", "spectator"]);
export const campaignPrivacy = pgEnum("campaign_privacy", ["public", "invite_only", "private"]);
export const characterKind = pgEnum("character_kind", ["pc", "npc", "monster"]);
export const chatChannel = pgEnum("chat_channel", ["global", "party", "dm", "whisper", "system"]);
export const rollVisibility = pgEnum("roll_visibility", ["public", "private", "dm_only", "whisper", "blind"]);
export const assetKind = pgEnum("asset_kind", ["map", "token", "portrait", "avatar", "cover", "handout", "other"]);
export const tokenLayer = pgEnum("token_layer", ["map", "objects", "tokens", "dm"]);
export const tokenShape = pgEnum("token_shape", ["circle", "square"]);
export const fogMode = pgEnum("fog_mode", ["reveal", "hide"]);
export const hpVisibility = pgEnum("hp_visibility", ["everyone", "owners", "gm"]);
export const combatStatus = pgEnum("combat_status", ["active", "ended"]);
export const gameSessionStatus = pgEnum("game_session_status", ["active", "paused", "ended"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash"),
    isGuest: boolean("is_guest").notNull().default(false),
    avatarUrl: text("avatar_url"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    guestExpiresAt: timestamp("guest_expires_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("auth_sessions_token_idx").on(t.tokenHash), index("auth_sessions_user_idx").on(t.userId)],
);

export interface CampaignSettings {
  permissions?: Record<string, { grant?: string[]; revoke?: string[] }>;
}

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    coverImageUrl: text("cover_image_url"),
    rulesetId: text("ruleset_id").notNull(),
    setting: text("setting").notNull().default(""),
    theme: text("theme").notNull().default("dark-fantasy"),
    maxPlayers: integer("max_players").notNull().default(6),
    privacy: campaignPrivacy("privacy").notNull().default("invite_only"),
    passwordHash: text("password_hash"),
    houseRules: text("house_rules").notNull().default(""),
    settings: jsonb("settings").$type<CampaignSettings>().notNull().default({}),
    /** Scene players currently see (no FK to avoid a campaigns<->scenes cycle; validated in code). */
    activeSceneId: uuid("active_scene_id"),
    version: integer("version").notNull().default(1),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("campaigns_owner_idx").on(t.ownerId), index("campaigns_privacy_idx").on(t.privacy)],
);

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null = personal library character; set = campaign-owned NPC/monster. */
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    kind: characterKind("kind").notNull().default("pc"),
    name: text("name").notNull(),
    rulesetId: text("ruleset_id").notNull(),
    data: jsonb("data").$type<CharacterData>().notNull(),
    /** For campaign NPCs/monsters: whether players may view the sheet. */
    playerVisible: boolean("player_visible").notNull().default(false),
    isTemplate: boolean("is_template").notNull().default(false),
    /** Optimistic concurrency token; incremented on every update. */
    version: integer("version").notNull().default(1),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("characters_owner_idx").on(t.ownerId), index("characters_campaign_idx").on(t.campaignId)],
);

export const campaignMembers = pgTable(
  "campaign_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: campaignRole("role").notNull(),
    activeCharacterId: uuid("active_character_id").references(() => characters.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("campaign_members_unique_idx").on(t.campaignId, t.userId),
    index("campaign_members_user_idx").on(t.userId),
  ],
);

export const campaignInvitations = pgTable(
  "campaign_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    role: campaignRole("role").notNull().default("player"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaign_invitations_code_idx").on(t.code), index("campaign_invitations_campaign_idx").on(t.campaignId)],
);

export const gameSessions = pgTable(
  "game_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    status: gameSessionStatus("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("game_sessions_campaign_idx").on(t.campaignId),
    // At most one non-ended session per campaign.
    uniqueIndex("game_sessions_one_open_idx").on(t.campaignId).where(sql`${t.status} <> 'ended'`),
    uniqueIndex("game_sessions_number_idx").on(t.campaignId, t.number),
  ],
);

export const diceRolls = pgTable(
  "dice_rolls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }),
    gameSessionId: uuid("game_session_id").references(() => gameSessions.id, { onDelete: "set null" }),
    formula: text("formula").notNull(),
    label: text("label").notNull().default(""),
    rollType: text("roll_type").notNull().default("custom"),
    visibility: rollVisibility("visibility").notNull().default("public"),
    recipientIds: uuid("recipient_ids").array().notNull().default(sql`'{}'::uuid[]`),
    total: integer("total").notNull(),
    result: jsonb("result").$type<RollResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dice_rolls_campaign_created_idx").on(t.campaignId, t.createdAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /** Null for system messages. */
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
    characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }),
    channel: chatChannel("channel").notNull().default("global"),
    recipientIds: uuid("recipient_ids").array().notNull().default(sql`'{}'::uuid[]`),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("chat_messages_campaign_created_idx").on(t.campaignId, t.createdAt)],
);

/*
 * Phase 2: assets, scenes (maps), tokens, fog.
 */

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null = personal asset (avatar/portrait); set = campaign asset readable by members. */
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    kind: assetKind("kind").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Opaque key inside the storage backend. */
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    originalName: text("original_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("assets_owner_idx").on(t.ownerId), index("assets_campaign_idx").on(t.campaignId)],
);

export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    backgroundAssetId: uuid("background_asset_id").references(() => assets.id, { onDelete: "set null" }),
    backgroundColor: text("background_color").notNull().default("#1a1714"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    grid: jsonb("grid").$type<GridSettings>().notNull(),
    fogEnabled: boolean("fog_enabled").notNull().default(false),
    dmNotes: text("dm_notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("scenes_campaign_idx").on(t.campaignId)],
);

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    imageAssetId: uuid("image_asset_id").references(() => assets.id, { onDelete: "set null" }),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    size: real("size").notNull().default(1),
    rotation: real("rotation").notNull().default(0),
    layer: tokenLayer("layer").notNull().default("tokens"),
    shape: tokenShape("shape").notNull().default("circle"),
    color: text("color").notNull().default("#7d241c"),
    borderColor: text("border_color").notNull().default("#d9b14f"),
    hidden: boolean("hidden").notNull().default(false),
    locked: boolean("locked").notNull().default(false),
    showName: boolean("show_name").notNull().default(true),
    ownerIds: uuid("owner_ids").array().notNull().default(sql`'{}'::uuid[]`),
    hpVisibility: hpVisibility("hp_visibility").notNull().default("gm"),
    /**
     * Vitals for tokens without a character sheet (monsters/props). Tokens linked to a
     * character read and write HP/conditions on the character instead (single source of truth).
     */
    stats: jsonb("stats").$type<TokenStats>(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [index("tokens_character_idx").on(t.characterId), index("tokens_scene_idx").on(t.sceneId), index("tokens_campaign_idx").on(t.campaignId)],
);

export interface TokenStats {
  hp: HpState;
  ac: number | null;
  initiativeBonus: number;
  conditions: TokenCondition[];
  defenses: Defenses;
}

export const fogOps = pgTable(
  "fog_ops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    /** Global, gap-tolerant insertion order; fog ops apply in seq order within a scene. */
    seq: integer("seq").generatedAlwaysAsIdentity(),
    mode: fogMode("mode").notNull(),
    shape: jsonb("shape").$type<FogShape>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fog_ops_scene_seq_idx").on(t.sceneId, t.seq)],
);

/*
 * Phase 4: combat.
 */

export const combats = pgTable(
  "combats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => scenes.id, { onDelete: "set null" }),
    status: combatStatus("status").notNull().default("active"),
    round: integer("round").notNull().default(1),
    turnIndex: integer("turn_index").notNull().default(0),
    /** Combatant whose turn it is (kept alongside turnIndex so reorders don't jump the turn). */
    activeCombatantId: uuid("active_combatant_id"),
    version: integer("version").notNull().default(1),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("combats_campaign_idx").on(t.campaignId),
    // One running combat per campaign.
    uniqueIndex("combats_one_active_idx").on(t.campaignId).where(sql`${t.status} = 'active'`),
  ],
);

export const combatants = pgTable(
  "combatants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    combatId: uuid("combat_id")
      .notNull()
      .references(() => combats.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
    characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    initiative: integer("initiative"),
    initiativeBonus: integer("initiative_bonus").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Hidden from players in the tracker (e.g. an ambusher not yet revealed). */
    hidden: boolean("hidden").notNull().default(false),
    defeated: boolean("defeated").notNull().default(false),
    actions: jsonb("actions").$type<ActionEconomy>().notNull(),
    /** Owners copied from the token at join time (who may roll initiative / end the turn). */
    ownerIds: uuid("owner_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("combatants_combat_idx").on(t.combatId),
    uniqueIndex("combatants_token_unique_idx").on(t.combatId, t.tokenId).where(sql`${t.tokenId} is not null`),
  ],
);

export type CombatRow = typeof combats.$inferSelect;
export type CombatantRow = typeof combatants.$inferSelect;

export type AssetRow = typeof assets.$inferSelect;
export type SceneRow = typeof scenes.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type FogOpRow = typeof fogOps.$inferSelect;

export type User = typeof users.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignMember = typeof campaignMembers.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type DiceRollRow = typeof diceRolls.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
