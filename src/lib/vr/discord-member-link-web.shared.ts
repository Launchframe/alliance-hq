export type DiscordMemberLinkWebOutcome =
  | { outcome: "confirm_identity"; gameUserName: string; gameServerNumber: number | null }
  | {
      outcome: "confirm_home_server";
      message: string;
      gameUserName: string;
      lookupServerNumber: number;
      allianceServerNumber: number;
      allianceTag: string | null;
    }
  | {
      outcome: "fuzzy_pick";
      message: string;
      candidates: Array<{ memberId: string; name: string }>;
    }
  | { outcome: "linked"; message: string; memberDisplayName: string }
  | { outcome: "officer_attention"; message: string }
  | { outcome: "wrong_server"; message: string }
  | { outcome: "position_not_home"; message: string }
  | { outcome: "guild_not_registered" }
  | { outcome: "declined"; message: string }
  | { outcome: "error"; message: string };
