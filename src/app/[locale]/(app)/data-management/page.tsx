import { getTranslations } from "next-intl/server";

import { DataManagementClient } from "@/components/data-management/DataManagementClient";
import {
  decorateBatchForViewer,
  listAllianceDataBatches,
} from "@/lib/data-management/batch-ledger.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { getRbacContext } from "@/lib/rbac/context";
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

  const rbac = await getRbacContext(session.id);
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
    <DataManagementClient
      initialBatches={batches.map((batch) => decorateBatchForViewer(batch, rbac))}
      scoreTargets={scoreTargets}
      initialScoreTarget={initialScoreTarget}
    />
  );
}
