import { getTranslations } from "next-intl/server";

import { DataManagementClient } from "@/components/data-management/DataManagementClient";
import { HybridAshedPageShell } from "@/components/hybrid-ashed/HybridAshedPageShell";
import {
  decorateBatchForViewer,
  listAllianceDataBatches,
} from "@/lib/data-management/batch-ledger.server";
import { resolveDataManagementRbac } from "@/lib/data-management/api-context.server";
import { resolveCanUseAshedEmbedsForSession } from "@/lib/dashboard/page-context.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { SCORE_TARGETS } from "@/lib/video/score-targets";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dataManagement");
  return { title: t("title") };
}

export default async function DataManagementPage() {
  const session = await requirePageSession("/data-management");
  await requirePagePermission(session.id, "data:read", "/members");

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return null;
  }

  const [rbac, canUseAshedEmbeds] = await Promise.all([
    resolveDataManagementRbac(session.id, allianceId),
    resolveCanUseAshedEmbedsForSession(session.id),
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
  const initialScoreTarget = scoreTargets[0]?.id ?? "desert-storm";
  const batches = await listAllianceDataBatches({
    allianceId,
    scoreTarget: initialScoreTarget,
    status: "active",
  });

  return (
    <HybridAshedPageShell
      pageId="dataManagement"
      canUseAshedPane={canUseAshedEmbeds}
    >
      <div className="px-4 py-6 md:px-0">
        <DataManagementClient
          initialBatches={batches.map((batch) =>
            decorateBatchForViewer(batch, rbac),
          )}
          scoreTargets={scoreTargets}
          initialScoreTarget={initialScoreTarget}
        />
      </div>
    </HybridAshedPageShell>
  );
}
