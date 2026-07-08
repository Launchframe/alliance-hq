export type MembersAttentionSummary = {
  rosterLinkRequests: number;
  onboardingReviews: number;
  memberLinkHelp: number;
  /** 1 when a fresh roster video upload is recommended; otherwise 0. */
  rosterVideoUpload: number;
  unrankedMembers: number;
};

export const EMPTY_MEMBERS_ATTENTION_SUMMARY: MembersAttentionSummary = {
  rosterLinkRequests: 0,
  onboardingReviews: 0,
  memberLinkHelp: 0,
  rosterVideoUpload: 0,
  unrankedMembers: 0,
};
