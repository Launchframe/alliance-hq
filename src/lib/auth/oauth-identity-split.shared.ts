export type OAuthIdentitySplitRow = {
  provider: "discord";
  discordUserId: string;
  expectedHqUserId: string;
  oauthHqUserId: string;
  oauthHqUserEmail: string;
  ashedMemberId: string;
  allianceId: string;
  allianceSlug: string;
};

export type OAuthIdentitySplitSummary = {
  hasSplit: boolean;
  splits: OAuthIdentitySplitRow[];
};
