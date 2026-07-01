/** Max in-game characters linkable to one Discord user per alliance. */
export const MAX_DISCORD_LINKS_PER_USER = 5;

/** Max rally teams per `/vr-report teams:N` or `/takedown-teams` request. */
export const MAX_TAKEDOWN_TEAMS = 5;

/** Sources persisted on member_season_vr_events.source */
export type VrEventSource =
  | "discord"
  | "web"
  | "officer_override"
  | "backfill";
