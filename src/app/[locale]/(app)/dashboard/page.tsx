import { getTranslations } from "next-intl/server";

import { AllianceDashboard } from "@/components/dashboard/AllianceDashboard";
import { HybridAshedPageShell } from "@/components/hybrid-ashed/HybridAshedPageShell";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { getPageSessionState, requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage() {
  const session = await requirePageSession("/dashboard");
  await requirePagePermission(session.id, "members:read", "/members");
  const state = await getPageSessionState("/dashboard");

  return (
    <HybridAshedPageShell pageId="dashboard" canUseAshedPane={state.canUseAshedEmbeds}>
      <div className="px-4 py-6 md:px-0">
        <AllianceDashboard />
      </div>
    </HybridAshedPageShell>
  );
}
