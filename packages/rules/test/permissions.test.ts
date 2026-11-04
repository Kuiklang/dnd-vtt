import { describe, expect, it } from "vitest";
import { can, canManageMember, canSeeChatMessage, resolveCapabilities, rollViewFor } from "../src/index.js";

describe("roles", () => {
  it("gives DMs table control and players limited rights", () => {
    expect(can("dm", "fog.manage")).toBe(true);
    expect(can("dm", "campaign.delete")).toBe(false);
    expect(can("owner", "campaign.delete")).toBe(true);
    expect(can("co_dm", "campaign.edit")).toBe(false);
    expect(can("co_dm", "combat.manage")).toBe(true);
    expect(can("player", "dice.roll")).toBe(true);
    expect(can("player", "dmNotes.view")).toBe(false);
    expect(can("player", "fog.manage")).toBe(false);
    expect(can("spectator", "dice.roll")).toBe(false);
    expect(can("spectator", "token.controlOwn")).toBe(false);
  });

  it("applies overrides but never grants DM-only capabilities to players", () => {
    const caps = resolveCapabilities("player", { player: { grant: ["music.control", "dmNotes.view"], revoke: ["chat.whisper"] } });
    expect(caps.has("music.control")).toBe(true);
    expect(caps.has("dmNotes.view")).toBe(false);
    expect(caps.has("chat.whisper")).toBe(false);
    expect(resolveCapabilities("spectator", { spectator: { revoke: ["campaign.view"] } }).has("campaign.view")).toBe(true);
  });

  it("only lets higher ranks manage lower ranks", () => {
    expect(canManageMember("owner", "dm", "player")).toBe(true);
    expect(canManageMember("owner", "player", "dm")).toBe(true);
    expect(canManageMember("dm", "player", "co_dm")).toBe(true);
    expect(canManageMember("dm", "player", "dm")).toBe(false);
    expect(canManageMember("dm", "dm", null)).toBe(false);
    expect(canManageMember("co_dm", "player", null)).toBe(true);
    expect(canManageMember("player", "spectator", null)).toBe(false);
    expect(canManageMember("owner", "player", "owner")).toBe(false);
  });
});

describe("visibility", () => {
  const dm = { userId: "dm", isGameMaster: true, isSpectator: false };
  const author = { userId: "a", isGameMaster: false, isSpectator: false };
  const other = { userId: "b", isGameMaster: false, isSpectator: false };
  const spec = { userId: "s", isGameMaster: false, isSpectator: true };
  const roll = { authorId: "a", recipientIds: ["b"] };

  it("handles all roll visibilities", () => {
    expect([dm, author, other].map((v) => rollViewFor("public", roll, v))).toEqual(["full", "full", "full"]);
    expect([dm, author, other].map((v) => rollViewFor("private", roll, v))).toEqual(["full", "full", "none"]);
    expect([dm, author, other].map((v) => rollViewFor("dm_only", roll, v))).toEqual(["full", "none", "none"]);
    expect([dm, author, other, spec].map((v) => rollViewFor("whisper", roll, v))).toEqual(["full", "full", "full", "none"]);
    expect([dm, author, other].map((v) => rollViewFor("blind", roll, v))).toEqual(["full", "redacted", "none"]);
  });

  it("filters chat channels", () => {
    const msg = { authorId: "a", recipientIds: ["b"] };
    expect(canSeeChatMessage("party", msg, spec)).toBe(false);
    expect(canSeeChatMessage("party", msg, other)).toBe(true);
    expect(canSeeChatMessage("dm", msg, other)).toBe(false);
    expect(canSeeChatMessage("dm", msg, dm)).toBe(true);
    expect(canSeeChatMessage("whisper", msg, other)).toBe(true);
    expect(canSeeChatMessage("whisper", msg, dm)).toBe(false);
    expect(canSeeChatMessage("whisper", { authorId: "a", recipientIds: [] }, spec)).toBe(false);
  });
});
