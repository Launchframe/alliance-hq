import {
  isPostgresUniqueViolation,
  readPostgresConstraintName,
} from "@/lib/auth/postgres-unique.shared";

/** Unique indexes that enforce one Last War UID claim per alliance. */
export const HQ_MEMBER_LINK_GAME_UID_UNIQUE =
  "hq_member_links_alliance_game_uid_unique";
export const DISCORD_MEMBER_LINK_GAME_UID_UNIQUE =
  "discord_member_links_alliance_game_uid_unique";

/**
 * Maps a Postgres unique_violation on (alliance_id, game_uid) to a soft
 * conflict. Concurrent link posts can both pass the application claim check
 * before either insert commits — the unique index is the authoritative gate.
 */
export function isMemberLinkGameUidUniqueViolation(error: unknown): boolean {
  if (!isPostgresUniqueViolation(error)) return false;
  const constraint = readPostgresConstraintName(error);
  if (!constraint) {
    // Some drivers omit constraint; still treat 23505 from link writes as a
    // claim conflict rather than a 500 (alliance/user/member uniques are also
    // claim conflicts for this call site).
    return true;
  }
  return (
    constraint === HQ_MEMBER_LINK_GAME_UID_UNIQUE ||
    constraint === DISCORD_MEMBER_LINK_GAME_UID_UNIQUE ||
    constraint === "hq_member_links_alliance_user_unique" ||
    constraint === "hq_member_links_alliance_member_unique" ||
    constraint === "discord_member_links_alliance_discord_member_unique" ||
    constraint === "discord_member_links_alliance_member_unique"
  );
}
