import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import type {
  OfficerReviewRosterCandidate,
  RosterSubstringSuggestion,
} from "@/lib/vr/link-helpers";

export type AdminUidInspectorRosterSource =
  | "native_local"
  | "local_synced"
  | "ashed_live"
  | "empty"
  | "not_loaded";

export type AdminUidInspectorAllianceOption = {
  id: string;
  name: string;
  slug: string;
  tag: string | null;
};

export type AdminUidInspectorHqLink = {
  id: string;
  allianceId: string;
  allianceName: string;
  allianceTag: string | null;
  allianceSlug: string;
  hqUserId: string;
  hqUserEmail: string | null;
  hqUserDisplayName: string | null;
  ashedMemberId: string;
  memberDisplayName: string | null;
  linkedAt: string;
};

export type AdminUidInspectorDiscordLink = {
  id: string;
  allianceId: string;
  allianceName: string;
  allianceTag: string | null;
  allianceSlug: string;
  discordUserId: string;
  discordUsername: string | null;
  ashedMemberId: string;
  memberDisplayName: string | null;
  linkedAt: string;
};

export type AdminUidInspectorAllianceMember = {
  allianceId: string;
  allianceName: string;
  allianceTag: string | null;
  allianceSlug: string;
  ashedMemberId: string;
  currentName: string;
  status: string;
  gameUid: string | null;
};

export type AdminUidInspectorRosterLinkRequest = {
  id: string;
  allianceId: string;
  allianceTag: string | null;
  allianceName: string;
  status: string;
  origin: string;
  reportedName: string;
  gameUserName: string;
  hqUserId: string | null;
  hqUserEmail: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  suggestedTargetAshedMemberId: string | null;
  suggestionMethod: string | null;
  suggestedMatchedRosterName: string | null;
  createdAt: string;
};

export type AdminUidInspectorOnboardingReview = {
  id: string;
  allianceId: string;
  allianceTag: string | null;
  allianceName: string;
  status: string;
  origin: string;
  gameUserName: string;
  linkedAshedMemberId: string;
  hqUserId: string | null;
  discordUserId: string | null;
  createdAt: string;
};

export type AdminUidInspectorHelpRequest = {
  id: string;
  allianceId: string;
  allianceTag: string | null;
  allianceName: string;
  status: string;
  origin: string;
  context: string;
  requesterHandle: string;
  reportedName: string | null;
  gameUserName: string | null;
  hqUserId: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  claimConflictReason: string | null;
  createdAt: string;
};

export type AdminUidInspectorCommanderRecord = {
  id: string;
  primaryName: string | null;
  gameServerNumber: number | null;
  memberLevel: number | null;
  heroPowerM: number | null;
  currentAllianceId: string | null;
  currentAllianceTag: string | null;
  updatedAt: string;
};

export type AdminUidInspectorDiscordAuditRow = {
  id: string;
  allianceId: string;
  allianceTag: string | null;
  command: string;
  discordUserId: string | null;
  createdAt: string;
  memberTaken: boolean;
  linked: boolean;
  needsOfficerAttention: boolean;
  needsIdentityConfirmation: boolean;
  replyPreview: string | null;
  rosterSize: number | null;
  guildRegistered: boolean | null;
};

export type AdminUidInspectorRosterSuggestions = {
  allianceId: string;
  allianceTag: string | null;
  allianceName: string;
  rosterSource: AdminUidInspectorRosterSource;
  rosterCount: number;
  exactMatch: {
    ashedMemberId: string;
    memberName: string;
    isLinked: boolean;
  } | null;
  substringSuggestion: RosterSubstringSuggestion | null;
  fuzzyCandidates: OfficerReviewRosterCandidate[];
};

export type AdminUidInspectorResult = {
  gameUid: string;
  lastWarLookup: LastWarPlayerLookupResult;
  commander: AdminUidInspectorCommanderRecord | null;
  hqMemberLinks: AdminUidInspectorHqLink[];
  discordMemberLinks: AdminUidInspectorDiscordLink[];
  allianceMembers: AdminUidInspectorAllianceMember[];
  rosterLinkRequests: AdminUidInspectorRosterLinkRequest[];
  onboardingReviews: AdminUidInspectorOnboardingReview[];
  memberLinkHelpRequests: AdminUidInspectorHelpRequest[];
  recentDiscordAudit: AdminUidInspectorDiscordAuditRow[];
  rosterSuggestions: AdminUidInspectorRosterSuggestions | null;
  alliances: AdminUidInspectorAllianceOption[];
};
