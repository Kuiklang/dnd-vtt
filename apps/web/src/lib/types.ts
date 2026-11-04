import type { CampaignRole, Capability, CharacterData, CharacterKind, ChatChannel, RollResult, RollVisibility } from "@vtt/rules";

export interface SelfUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  email: string | null;
  guestExpiresAt: string | null;
  settings: { diceAnimation?: boolean; diceSound?: boolean; defaultRollVisibility?: RollVisibility };
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

export type Privacy = "public" | "invite_only" | "private";

export interface CampaignSummary {
  id: string;
  name: string;
  description: string;
  coverImageUrl: string | null;
  rulesetId: string;
  setting: string;
  theme: string;
  maxPlayers: number;
  privacy: Privacy;
  hasPassword: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardCampaign extends CampaignSummary {
  role: CampaignRole;
  ownerName: string;
  memberCount: number;
  activeSessionId: string | null;
  endedSessions: number;
  lastPlayedAt: string | null;
}

export interface PublicCampaign extends CampaignSummary {
  ownerName: string;
  players: number;
  isMember: boolean;
}

export interface GameSession {
  id: string;
  number: number;
  name: string;
  status: "active" | "paused" | "ended";
  startedAt: string;
  endedAt: string | null;
}

export interface CampaignDetail {
  campaign: CampaignSummary & { houseRules: string; permissions?: Record<string, unknown> };
  me: { userId: string; role: CampaignRole; capabilities: Capability[]; activeCharacterId: string | null };
  members: Array<{
    userId: string;
    user: PublicUser;
    role: CampaignRole;
    joinedAt: string;
    character: { id: string; name: string; ownerId: string; portraitUrl: string; color: string; summary: string } | null;
  }>;
  activeSession: GameSession | null;
  sessions: GameSession[];
  invitations: Array<{ id: string; code: string; role: CampaignRole; uses: number; maxUses: number | null; expiresAt: string | null; createdAt: string }>;
}

export interface CharacterFull {
  id: string;
  name: string;
  kind: CharacterKind;
  ownerId: string;
  campaignId: string | null;
  rulesetId: string;
  data: CharacterData;
  playerVisible: boolean;
  isTemplate: boolean;
  version: number;
  updatedAt: string;
  access: "owner" | "edit" | "view";
}

export interface CharacterSummary {
  id: string;
  name: string;
  kind: CharacterKind;
  ownerId: string;
  portraitUrl: string;
  color: string;
  summary: string;
  access: "summary";
}

export interface ChatMessage {
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

export interface RollEntry {
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
  formula?: string;
  total?: number;
  result?: RollResult;
  redacted: boolean;
}

export interface PresenceView {
  userId: string;
  status: "online" | "reconnecting" | "offline";
  ready: boolean;
}

export interface RulesetInfo {
  id: string;
  name: string;
  version: string;
  attribution: string;
}
