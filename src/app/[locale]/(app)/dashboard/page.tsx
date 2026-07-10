import { getTranslations } from "next-intl/server";

import { AllianceDashboard } from "@/components/dashboard/AllianceDashboard";
import { HybridAshedPageShell } from "@/components/hybrid-ashed/HybridAshedPageShell";
import { loadDashboardInitialData } from "@/lib/analytics/dashboard-summary.server";
import { collectDatabaseErrorText } from "@/lib/db/error-message";
import { resolveCanUseAshedEmbedsForSession } from "@/lib/dashboard/page-context.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage() {
  const session = await requirePageSession("/dashboard");
  await requirePagePermission(session.id, "members:read", "/members");

  const [canUseAshedEmbeds, initialData] = await Promise.all([
    resolveCanUseAshedEmbedsForSession(session.id),
    loadDashboardInitialData(session.id).catch((error) => {
      console.error("[dashboard/page]", collectDatabaseErrorText(error));
      return null;
    }),
  ]);

  return (
    <HybridAshedPageShell pageId="dashboard" canUseAshedPane={canUseAshedEmbeds}>
      <div className="px-4 py-6 md:px-0">
        <AllianceDashboard
          initialSummary={initialData?.summary ?? null}
          initialVr={initialData?.vr ?? null}
        />
      </div>
    </HybridAshedPageShell>
  );
}
