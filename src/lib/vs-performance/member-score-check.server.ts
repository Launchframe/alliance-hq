import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { mergeVsDailySources } from "@/lib/vs-scores/evidence.shared";
import { listVsHeads } from "@/lib/vs-scores/repository.server";
import { fetchRemoteVsScope } from "@/lib/vs-scores/sync.server";
import { VsSyncError } from "@/lib/vs-scores/ashed-transport.server";
import { loadVsAllianceLink, resolveVsScoreReadContext } from "./ashed-opponent-sync.server";
import type { VsActor } from "./weekly-view.shared";

export async function loadVsMemberScoreEvidence(actor: VsActor, recordedDate: string): Promise<Map<string, number>> {
  const local = await listVsHeads(actor.allianceId, { recordedDate, period: "daily" });
  const link = await loadVsAllianceLink(actor.allianceId);
  if (!link) return mergeVsDailySources(local, new Map());
  const context = await resolveVsScoreReadContext(actor);
  if (!context || context.ashedAllianceId !== link.ashedAllianceId) throw new VsSyncError("credentials_required");
  const rows = await fetchRemoteVsScope({
    connection: context.connection,
    allianceId: context.ashedAllianceId,
    appId: context.connection.appId,
  }, recordedDate, "daily");
  const remote = new Map<string, number>();
  for (const row of rows) {
    const previous = remote.get(row.memberId);
    if (previous === undefined || row.score > previous) remote.set(row.memberId, row.score);
  }
  const [scope] = local.some(row => row.origin === "derived") ? await getDb()
    .select({ managed: schema.vsScoreSyncScopes.managedScores })
    .from(schema.vsScoreSyncScopes)
    .where(and(
      eq(schema.vsScoreSyncScopes.allianceId, actor.allianceId),
      eq(schema.vsScoreSyncScopes.recordedDate, recordedDate),
      eq(schema.vsScoreSyncScopes.period, "daily"),
    )).limit(1) : [];
  return mergeVsDailySources(local, remote, scope?.managed);
}
