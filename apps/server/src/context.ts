import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { User } from "./db/schema.js";
import type { AuthService } from "./auth/service.js";
import type { CampaignService } from "./campaigns/service.js";
import type { CharacterService } from "./characters/service.js";
import type { ChatService } from "./chat/service.js";
import type { Realtime } from "./realtime/socket.js";
import type { AssetService } from "./assets/service.js";
import type { SceneService } from "./scenes/service.js";
import type { CombatService } from "./combat/service.js";
import type { DmToolsService } from "./dmtools/service.js";
import type { TimelineService } from "./timeline/service.js";
import type { AudioService } from "./audio/service.js";
import type { CharacterActions } from "./characters/actions.js";

export interface AppContext {
  config: Config;
  db: Db;
  auth: AuthService;
  campaigns: CampaignService;
  characters: CharacterService;
  chat: ChatService;
  assets: AssetService;
  scenes: SceneService;
  combat: CombatService;
  dmTools: DmToolsService;
  timeline: TimelineService;
  audio: AudioService;
  actions: CharacterActions;
  /** Set once Socket.IO is attached; services use it to broadcast REST-originated changes. */
  realtime?: Realtime;
}

export interface RequestAuth {
  user: User;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
}

export const SESSION_COOKIE = "vtt_session";
