/**
 * Campaign role-based access control. This module is shared by server and client;
 * the client uses it only to decide what to *show* — the server re-checks every
 * capability before acting or sending data.
 */

export const CAMPAIGN_ROLES = ["owner", "dm", "co_dm", "player", "spectator"] as const;
export type CampaignRole = (typeof CAMPAIGN_ROLES)[number];

export const CAPABILITIES = [
  "campaign.view",
  "campaign.edit",
  "campaign.delete",
  "members.invite",
  "members.manage",
  "session.control",
  "chat.send",
  "chat.whisper",
  "chat.readDmChannel",
  "chat.moderate",
  "dice.roll",
  "dice.rollHidden",
  "dice.seeHidden",
  "character.selectOwn",
  "character.viewParty",
  "character.viewAll",
  "character.editAll",
  "npc.manage",
  "map.manage",
  "token.manageAll",
  "token.controlOwn",
  "fog.manage",
  "combat.manage",
  "music.control",
  "handout.send",
  "dmNotes.view",
  /** Read and write every journal entry, including DM-only ones (Phase 5). */
  "journal.manage",
  /** Create, edit and roll campaign random tables (Phase 5). */
  "tables.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const DM_CAPS: Capability[] = CAPABILITIES.filter((c) => c !== "campaign.delete");

const PLAYER_CAPS: Capability[] = [
  "campaign.view",
  "chat.send",
  "chat.whisper",
  "dice.roll",
  "character.selectOwn",
  "character.viewParty",
  "token.controlOwn",
];

export const ROLE_CAPABILITIES: Record<CampaignRole, ReadonlySet<Capability>> = {
  owner: new Set(CAPABILITIES),
  dm: new Set(DM_CAPS),
  // Co-DMs run the table but cannot change campaign settings or promote DMs.
  co_dm: new Set(DM_CAPS.filter((c) => c !== "campaign.edit")),
  player: new Set(PLAYER_CAPS),
  spectator: new Set<Capability>(["campaign.view", "chat.send", "character.viewParty"]),
};

/** Per-campaign fine-grained adjustments stored in campaign settings. */
export type PermissionOverrides = Partial<
  Record<Exclude<CampaignRole, "owner">, { grant?: Capability[]; revoke?: Capability[] }>
>;

/** Capabilities that can never be granted to non-DM roles via overrides. */
const DM_ONLY: ReadonlySet<Capability> = new Set<Capability>([
  "campaign.edit",
  "campaign.delete",
  "members.manage",
  "dice.seeHidden",
  "chat.readDmChannel",
  "character.editAll",
  "character.viewAll",
  "npc.manage",
  "fog.manage",
  "dmNotes.view",
  "journal.manage",
]);

export function resolveCapabilities(role: CampaignRole, overrides?: PermissionOverrides): Set<Capability> {
  const caps = new Set(ROLE_CAPABILITIES[role]);
  if (role === "owner" || !overrides) return caps;
  const o = overrides[role];
  const isDmRole = role === "dm" || role === "co_dm";
  for (const c of o?.grant ?? []) if (isDmRole || !DM_ONLY.has(c)) caps.add(c);
  for (const c of o?.revoke ?? []) caps.delete(c);
  // Viewing the campaign is fundamental to membership.
  caps.add("campaign.view");
  return caps;
}

export function can(role: CampaignRole, cap: Capability, overrides?: PermissionOverrides): boolean {
  return resolveCapabilities(role, overrides).has(cap);
}

export const ROLE_RANK: Record<CampaignRole, number> = { owner: 4, dm: 3, co_dm: 2, player: 1, spectator: 0 };

export function isGameMaster(role: CampaignRole): boolean {
  return role === "owner" || role === "dm" || role === "co_dm";
}

/**
 * Whether `actor` may change `target`'s role to `newRole` (or remove them when
 * newRole is null). Actors can only act on lower-ranked members and can only
 * assign roles below their own rank. Nobody can assign "owner" this way.
 */
export function canManageMember(actor: CampaignRole, target: CampaignRole, newRole: CampaignRole | null): boolean {
  if (!can(actor, "members.manage")) return false;
  if (ROLE_RANK[actor] <= ROLE_RANK[target]) return false;
  if (newRole === null) return true;
  if (newRole === "owner") return false;
  return ROLE_RANK[newRole] < ROLE_RANK[actor];
}

export const ROLE_LABELS: Record<CampaignRole, string> = {
  owner: "Owner",
  dm: "Dungeon Master",
  co_dm: "Co-DM",
  player: "Player",
  spectator: "Spectator",
};

/** Validates permission overrides coming from untrusted input. */
export function sanitizePermissionOverrides(raw: unknown): PermissionOverrides {
  const out: PermissionOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  const capSet = new Set<string>(CAPABILITIES);
  for (const role of ["dm", "co_dm", "player", "spectator"] as const) {
    const entry = (raw as Record<string, unknown>)[role];
    if (!entry || typeof entry !== "object") continue;
    const clean = (v: unknown): Capability[] =>
      Array.isArray(v) ? (v.filter((x) => typeof x === "string" && capSet.has(x)) as Capability[]) : [];
    out[role] = {
      grant: clean((entry as Record<string, unknown>).grant),
      revoke: clean((entry as Record<string, unknown>).revoke),
    };
  }
  return out;
}
