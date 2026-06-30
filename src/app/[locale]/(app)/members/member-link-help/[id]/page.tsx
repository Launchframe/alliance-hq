import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { MemberLinkHelpRequestReviewClient } from "@/components/members/MemberLinkHelpRequestReviewClient";
import { loadMemberLinkHelpRequestReview } from "@/lib/member-link/member-link-help-review.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("memberLinkHelpReview");
  return { title: t("title") };
}

export default async function MemberLinkHelpDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const session = await requirePageSession("/members/member-link-help");
  const canResolve = await sessionHasPermission(session.id, "members:write");
  if (!canResolve) {
    redirect({ href: "/members", locale });
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  const review = allianceId
    ? await loadMemberLinkHelpRequestReview({ requestId: id, allianceId })
    : null;
  if (!review || review.request.status !== "open") {
    notFound();
  }

  const t = await getTranslations("memberLinkHelpReview");

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 min-w-0 w-full">
      <MemberLinkHelpRequestReviewClient
        initialReview={{
          ...review,
          request: {
            ...review.request,
            createdAt: review.request.createdAt.toISOString(),
          },
        }}
        linkUrlPrefix="/api/members/member-link-help-requests"
        resolveUrlPrefix="/api/members/member-link-help-requests"
        backHref="/members/member-link-help"
        backLabel={t("backToList")}
      />
    </div>
  );
}
