import { getTranslations } from "next-intl/server";

import { HeroPowerDetailClient } from "@/components/dashboard/HeroPowerDetailClient";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dashboard.heroPowerPage");
  return { title: t("title") };
}

export default async function HeroPowerDashboardPage() {
  const session = await requirePageSession("/dashboard/hero-power");
  await requirePagePermission(session.id, "members:read", "/members");

  return (
    <div className="px-4 py-6 md:px-0">
      <HeroPowerDetailClient />
    </div>
  );
}
