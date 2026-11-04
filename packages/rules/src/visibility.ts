/**
 * Who may see a dice roll or chat message. Pure functions so the server can
 * filter per recipient and the logic can be unit tested in isolation.
 */

export const ROLL_VISIBILITIES = ["public", "private", "dm_only", "whisper", "blind"] as const;
export type RollVisibility = (typeof ROLL_VISIBILITIES)[number];

export const ROLL_VISIBILITY_LABELS: Record<RollVisibility, string> = {
  public: "Public — everyone sees it",
  private: "Private — you and the DMs",
  dm_only: "DM only — hidden GM roll",
  whisper: "Whisper — you and chosen players (+ DMs)",
  blind: "Blind — only DMs see the result",
};

export const CHAT_CHANNELS = ["global", "party", "dm", "whisper", "system"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export interface Viewer {
  userId: string;
  /** Has dice.seeHidden / chat.readDmChannel (i.e. a DM). */
  isGameMaster: boolean;
  /** Spectators are not part of the party channel. */
  isSpectator: boolean;
}

export interface Addressed {
  authorId: string;
  recipientIds: string[];
}

export type RollView = "full" | "redacted" | "none";

/** How `viewer` sees a roll with the given visibility. */
export function rollViewFor(visibility: RollVisibility, roll: Addressed, viewer: Viewer): RollView {
  const isAuthor = viewer.userId === roll.authorId;
  switch (visibility) {
    case "public":
      return "full";
    case "private":
      return isAuthor || viewer.isGameMaster ? "full" : "none";
    case "dm_only":
      return viewer.isGameMaster ? "full" : "none";
    case "whisper":
      return isAuthor || viewer.isGameMaster || roll.recipientIds.includes(viewer.userId) ? "full" : "none";
    case "blind":
      if (viewer.isGameMaster) return "full";
      return isAuthor ? "redacted" : "none";
  }
}

export function canSeeChatMessage(channel: ChatChannel, msg: Addressed, viewer: Viewer): boolean {
  const isAuthor = viewer.userId === msg.authorId;
  switch (channel) {
    case "global":
    case "system":
      return true;
    case "party":
      return isAuthor || viewer.isGameMaster || !viewer.isSpectator;
    case "dm":
      return isAuthor || viewer.isGameMaster;
    case "whisper":
      // Whispers are private between participants; DMs do NOT see player-to-player whispers.
      return isAuthor || msg.recipientIds.includes(viewer.userId);
  }
}
