import { getTranslations } from "next-intl/server";

import { DonationsDetailClient } from "@/components/dashboard/DonationsDetailClient";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dashboard.donationsPage");
  return { title: t("title") };
}

export default async function DonationsDashboardPage() {
  const session = await requirePageSession("/dashboard/donations");
  await requirePagePermission(session.id, "members:read", "/members");

  return (
    <div className="px-4 py-6 md:px-0">
      <DonationsDetailClient />
    </div>
  );
}
