export type DiscordMemberLinkWebOutcome =
  | { outcome: "confirm_identity"; gameUserName: string; gameServerNumber: number | null }
  | {
      outcome: "fuzzy_pick";
      message: string;
      candidates: Array<{ memberId: string; name: string }>;
    }
  | { outcome: "linked"; message: string; memberDisplayName: string }
  | { outcome: "officer_attention"; message: string }
  | { outcome: "wrong_server"; message: string }
  | { outcome: "declined"; message: string }
  | { outcome: "error"; message: string };
