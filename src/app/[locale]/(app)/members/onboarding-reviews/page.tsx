import { getTranslations } from "next-intl/server";

import { OnboardingReviewsClient } from "@/components/members/OnboardingReviewsClient";
import { canSessionReviewOnboardingLinks } from "@/lib/member-link/onboarding-review.server";
import { listPendingOnboardingReviews } from "@/lib/member-link/onboarding-review.server";
import { loadAllianceMembers } from "@/lib/members/load";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("onboardingReviews");
  return { title: t("title") };
}

export default async function OnboardingReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/members/onboarding-reviews");
  const allianceId = session.currentAllianceId ?? session.allianceId;

  const canReview =
    allianceId &&
    (await canSessionReviewOnboardingLinks({
      sessionId: session.id,
      allianceId,
    }));

  if (!canReview) {
    redirect({ href: "/members", locale });
  }

  const [reviews, membersPayload] = await Promise.all([
    allianceId ? listPendingOnboardingReviews(allianceId) : Promise.resolve([]),
    loadAllianceMembers(session.id).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 min-w-0 w-full">
      <OnboardingReviewsClient
        initialReviews={reviews}
        initialMembers={
          membersPayload?.members.map((member) => ({
            id: member.id,
            current_name: member.current_name,
          })) ?? []
        }
      />
    </div>
  );
}
