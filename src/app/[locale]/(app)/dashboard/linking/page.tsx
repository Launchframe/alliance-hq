import { getTranslations } from "next-intl/server";

import { LinkingDetailClient } from "@/components/dashboard/LinkingDetailClient";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dashboard.linkingPage");
  return { title: t("title") };
}

export default async function LinkingDashboardPage() {
  const session = await requirePageSession("/dashboard/linking");
  await requirePagePermission(session.id, "members:read", "/members");

  return (
    <div className="px-4 py-6 md:px-0">
      <LinkingDetailClient />
    </div>
  );
}
