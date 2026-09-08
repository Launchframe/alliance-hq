import "server-only";

import { after, NextResponse } from "next/server";
import type { RbacContext } from "@/lib/rbac/context";
import { canManageAnyDataBatch, canManageDataBatch, type DataBatchRow } from "@/lib/data-management/batch-authorization.shared";
import { changeVsBatches, listVsHeads } from "./repository.server";
import { VsEvidenceError } from "./evidence.shared";
import { vsEvidenceErrorResponse } from "./errors.server";
import { syncVsScoresForAlliance } from "./sync.server";

export function isLocalVsBatch(batch: DataBatchRow) {
  return batch.scoreTarget === "vs-performance" && batch.contextJson.storage === "hq";
}

export async function localVsScores(allianceId: string, input: { recordedDate?: string; batchId?: string }) {
  const heads = await listVsHeads(allianceId, { ...input, rawOnly: true });
  return heads.filter((head) => head.score != null).map((head) => ({ id: head.id, memberId: head.memberId, memberName: head.memberName, score: head.score, rank: null, team: null }));
}

export async function changeLocalVsData(input: { allianceId: string; rbac: RbacContext; batches: DataBatchRow[]; newRecordedDate?: string; wholeDate?: string }) {
  try {
    if (!input.rbac.hqUserId || input.batches.some((batch) => !isLocalVsBatch(batch) || !canManageDataBatch(input.rbac, batch))) throw new VsEvidenceError("forbidden", 403);
    const result = await changeVsBatches({
      allianceId: input.allianceId, hqUserId: input.rbac.hqUserId, batchIds: input.batches.map((batch) => batch.id),
      expectedVersions: Object.fromEntries(input.batches.map((batch) => [batch.id, batch.contextJson.vsRevision ?? 0])),
      canManageAny: canManageAnyDataBatch(input.rbac), newRecordedDate: input.newRecordedDate, wholeDate: input.wholeDate,
    });
    after(async () => { await syncVsScoresForAlliance(input.allianceId); });
    return NextResponse.json({ ok: true, ...result, batchId: input.batches[0]?.id, status: input.newRecordedDate ? "moved" : "deleted", movedToDate: input.newRecordedDate });
  } catch (error) { return vsEvidenceErrorResponse(error, input.batches[0]?.contextJson.vsPeriod); }
}
