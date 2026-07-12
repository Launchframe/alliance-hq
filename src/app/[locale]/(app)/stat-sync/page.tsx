import { getTranslations } from "next-intl/server";

import { StatSyncReviewClient } from "@/components/stat-sync/stat-sync-review-client";
import { redirect } from "@/i18n/navigation";
import { listStatSyncReviewRows } from "@/lib/hq-ashed-stat-sync/review.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("statSync");
  return { title: t("title") };
}

export default async function StatSyncPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/stat-sync");
  const allowed = await sessionHasPermission(session.id, "members:write");
  if (!allowed) {
    redirect({ href: "/members", locale });
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  const initialRows = allianceId
    ? await listStatSyncReviewRows(allianceId, "thp")
    : [];

  return (
    <StatSyncReviewClient initialStat="thp" initialRows={initialRows} />
  );
}
