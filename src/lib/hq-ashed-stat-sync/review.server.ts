import "server-only";

import { assertAllianceAshedLinked } from "@/lib/alliance/ashed-write-guard";
import type { ParsedConnection } from "@/lib/connectionString";
import { killsStatSyncAdapter } from "@/lib/hq-ashed-stat-sync/kills.adapter";
import { thpStatSyncAdapter } from "@/lib/hq-ashed-stat-sync/thp.adapter";
import type {
  MonotonicStatId,
  StatSyncAdapter,
  StatSyncReviewRow,
} from "@/lib/hq-ashed-stat-sync/types";

function adapterFor(stat: MonotonicStatId): StatSyncAdapter {
  return stat === "thp" ? thpStatSyncAdapter : killsStatSyncAdapter;
}

export async function listStatSyncReviewRows(
  allianceId: string,
  stat: MonotonicStatId,
): Promise<StatSyncReviewRow[]> {
  return adapterFor(stat).listPendingOutbound(allianceId);
}

export async function keepHqStatOnAshed(input: {
  allianceId: string;
  stat: MonotonicStatId;
  commanderId: string;
  ashedMemberId: string;
  total: number;
  eventId: string | null;
  connection: ParsedConnection;
}): Promise<void> {
  await assertAllianceAshedLinked(input.allianceId);
  const adapter = adapterFor(input.stat);
  await adapter.putToAshed(input.connection, input.ashedMemberId, input.total);
  if (input.eventId) {
    await adapter.markEventSynced(input.eventId);
  }
}

export async function keepAshedStatOnHq(input: {
  allianceId: string;
  stat: MonotonicStatId;
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
  ashedTotal: number;
  eventId: string | null;
  hqUserId?: string | null;
}): Promise<void> {
  const adapter = adapterFor(input.stat);
  await adapter.applyAshedOnHq({
    commanderId: input.commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    total: Math.round(input.ashedTotal),
    source: "officer_override",
    hqUserId: input.hqUserId,
  });
  if (input.eventId) {
    await adapter.markEventSynced(input.eventId);
  }
}

export async function discardHqStatReport(input: {
  allianceId: string;
  stat: MonotonicStatId;
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
  eventId: string | null;
  connection: ParsedConnection | null;
  hqUserId?: string | null;
}): Promise<void> {
  const adapter = adapterFor(input.stat);
  const restored = await adapter.revertHqToPrevious({
    commanderId: input.commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    hqUserId: input.hqUserId,
    eventIdToDiscard: input.eventId,
  });
  if (input.connection && restored != null && restored > 0) {
    await assertAllianceAshedLinked(input.allianceId);
    await adapter.putToAshed(input.connection, input.ashedMemberId, restored);
  }
}
