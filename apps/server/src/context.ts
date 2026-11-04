import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { User } from "./db/schema.js";
import type { AuthService } from "./auth/service.js";
import type { CampaignService } from "./campaigns/service.js";
import type { CharacterService } from "./characters/service.js";
import type { ChatService } from "./chat/service.js";
import type { Realtime } from "./realtime/socket.js";

export interface AppContext {
  config: Config;
  db: Db;
  auth: AuthService;
  campaigns: CampaignService;
  characters: CharacterService;
  chat: ChatService;
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
