import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { MemberLinkHelpRequestReviewClient } from "@/components/members/MemberLinkHelpRequestReviewClient";
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
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePageSession("/admin/member-link-help");
  const review = await loadMemberLinkHelpRequestReview({ requestId: id });
  if (!review || review.request.status !== "open") {
    notFound();
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
      showAlliance
    />
  );
}
