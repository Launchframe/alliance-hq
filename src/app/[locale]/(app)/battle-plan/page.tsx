import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BattlePlanClient } from "@/components/battle-plan/BattlePlanClient";
import { loadBattlePlanDashboard } from "@/lib/battle-plan/load-dashboard.server";
import { BATTLE_PLAN_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("battlePlan");
  return { title: t("title") };
}

export default async function BattlePlanPage() {
  const session = await requirePageSession("/battle-plan");
  await requirePagePermission(session.id, BATTLE_PLAN_READ_PERMISSION);
  const dashboard = await loadBattlePlanDashboard(session.id);

  if (!dashboard || "forbidden" in dashboard) {
    notFound();
  }

  return <BattlePlanClient initial={dashboard} />;
}
