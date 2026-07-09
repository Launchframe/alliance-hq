import "server-only";

import { loadAllianceSetupGuideSignals } from "@/lib/alliance-setup-guide-server";
import { canReviewMemberLinks } from "@/lib/member-link/invite-onboarding-access.server";
import {
  countOpenMemberLinkHelpRequestsForAlliance,
} from "@/lib/member-link/member-link-help-queue.server";
import {
  canSessionReviewOnboardingLinks,
  countPendingOnboardingReviews,
} from "@/lib/member-link/onboarding-review.server";
import { loadAllianceMemberOnboardingRow } from "@/lib/member-link/self-service-onboarding.server";
import { countPendingRosterLinkRequests } from "@/lib/member-link/roster-link-resolve.server";
import { countActiveUnrankedAllianceMembers } from "@/lib/members/roster.server";
import {
  EMPTY_MEMBERS_ATTENTION_SUMMARY,
  type MembersAttentionSummary,
} from "@/lib/members/members-attention-summary.shared";
import { getRbacContext, sessionHasPermission } from "@/lib/rbac/context";
import { loadSession } from "@/lib/session";

export async function loadMembersAttentionSummary(
  sessionId: string,
): Promise<MembersAttentionSummary> {
  const session = await loadSession(sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId ?? null;
  if (!session?.hqUserId || !allianceId) {
    return EMPTY_MEMBERS_ATTENTION_SUMMARY;
  }

  const canWrite = await sessionHasPermission(sessionId, "members:write");
  if (!canWrite) {
    return EMPTY_MEMBERS_ATTENTION_SUMMARY;
  }

  const [alliance, ctx, canReviewOnboarding] = await Promise.all([
    loadAllianceMemberOnboardingRow(allianceId),
    getRbacContext(sessionId),
    canSessionReviewOnboardingLinks({ sessionId, allianceId }),
  ]);

  const canReviewRosterLinks =
    alliance && ctx ? canReviewMemberLinks(ctx, alliance) : false;

  const [
    rosterLinkRequests,
    onboardingReviews,
    memberLinkHelp,
    setupSignals,
    unrankedMembers,
  ] = await Promise.all([
    canReviewRosterLinks
      ? countPendingRosterLinkRequests(allianceId)
      : Promise.resolve(0),
    canReviewOnboarding
      ? countPendingOnboardingReviews(allianceId)
      : Promise.resolve(0),
    countOpenMemberLinkHelpRequestsForAlliance(allianceId),
    loadAllianceSetupGuideSignals({
      allianceId,
      hqUserId: session.hqUserId,
      sessionId,
    }),
    countActiveUnrankedAllianceMembers(allianceId),
  ]);

  return {
    rosterLinkRequests,
    onboardingReviews,
    memberLinkHelp,
    rosterVideoUpload: setupSignals.rosterHardeningComplete ? 0 : 1,
    unrankedMembers,
  };
}
