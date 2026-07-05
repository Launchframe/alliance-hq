import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { MemberLinkHelpRequestReviewClient } from "@/components/members/MemberLinkHelpRequestReviewClient";
import { redirect } from "@/i18n/navigation";
import { loadMemberLinkHelpRequestReview } from "@/lib/member-link/member-link-help-review.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("memberLinkHelpReview");
  return { title: t("adminTitle") };
}

export default async function AdminMemberLinkHelpDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  await requirePageSession("/admin/member-link-help");
  const review = await loadMemberLinkHelpRequestReview({ requestId: id });
  if (!review) {
    notFound();
  }
  if (review.request.status !== "open") {
    redirect({ href: "/admin/member-link-help", locale });
  }

  const t = await getTranslations("memberLinkHelpReview");

  return (
    <MemberLinkHelpRequestReviewClient
      initialReview={{
        ...review,
        request: {
          ...review.request,
          createdAt: review.request.createdAt.toISOString(),
        },
      }}
      linkUrlPrefix="/api/admin/member-link-help-requests"
      resolveUrlPrefix="/api/admin/member-link-help-requests"
      backHref="/admin/member-link-help"
      backLabel={t("backToAdminList")}
      completeRedirectHref="/admin/member-link-help"
      showAlliance
    />
  );
}
