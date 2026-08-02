import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { DataManagementClient } from "@/components/data-management/DataManagementClient";
import { HybridAshedPageShell } from "@/components/hybrid-ashed/HybridAshedPageShell";
import { buildDataDateSummaries } from "@/lib/data-management/batch-actions.server";
import { listAllianceDataBatches } from "@/lib/data-management/batch-ledger.server";
import { resolveDataManagementRbac } from "@/lib/data-management/api-context.server";
import { resolveCanUseAshedEmbedsForSession } from "@/lib/dashboard/page-context.server";
import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession, getAshedConnection } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getScoreTarget, SCORE_TARGETS } from "@/lib/video/score-targets";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dataManagement");
  return { title: t("title") };
}

type PageProps = {
  searchParams: Promise<{ scoreTarget?: string; recordedDate?: string }>;
};

export default async function DataManagementPage({ searchParams }: PageProps) {
  const session = await requirePageSession("/data-management");
  await requirePagePermission(session.id, "data:read", "/members");

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return null;
  }

  const params = await searchParams;

  const [rbac, canUseAshedEmbeds, connection, ashedAllianceId] =
    await Promise.all([
      resolveDataManagementRbac(session.id),
      resolveCanUseAshedEmbedsForSession(session.id),
      getAshedConnection(session.id),
      getAshedAllianceIdIfLinked(allianceId),
    ]);
  if (!rbac) {
    return null;
  }

  const scoreTargets = SCORE_TARGETS.filter((target) => target.enabled).map(
    (target) => ({
      id: target.id,
      labelKey: target.labelKey,
      submitEntity: target.submitEntity,
    }),
  );
  const requestedTarget = params.scoreTarget?.trim();
  const initialScoreTarget =
    (requestedTarget &&
      scoreTargets.some((target) => target.id === requestedTarget) &&
      requestedTarget) ||
    scoreTargets[0]?.id ||
    "desert-storm";
  const targetDef = getScoreTarget(initialScoreTarget);
  const ledgerBatches = targetDef
    ? await listAllianceDataBatches({
        allianceId,
        scoreTarget: targetDef.id,
        status: "active",
      })
    : [];
  const initialDates = targetDef
    ? await buildDataDateSummaries({
        connection,
        ashedAllianceId,
        submitEntity: targetDef.submitEntity,
        ledgerBatches,
        rbac,
      })
    : [];

  return (
    <HybridAshedPageShell
      pageId="dataManagement"
      canUseAshedPane={canUseAshedEmbeds}
    >
      <div className="px-4 py-6 md:px-0">
        <Suspense fallback={null}>
          <DataManagementClient
            initialDates={initialDates}
            scoreTargets={scoreTargets}
            initialScoreTarget={initialScoreTarget}
          />
        </Suspense>
      </div>
    </HybridAshedPageShell>
  );
}
