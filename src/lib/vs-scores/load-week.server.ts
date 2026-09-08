import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays } from "@/lib/trains/game-time";
import { resolveExcusedConnection } from "@/lib/time-off/excused-transport.server";
import { listVsHeads } from "./repository.server";
import { evaluateVsWeek, validateVsPeriod, VsEvidenceError, type VsEvidence, type VsWeekEvidence } from "./evidence.shared";
import { fetchRemoteVsScope } from "./sync.server";

export async function loadVsWeekEvidence(allianceId: string, weekEnding: string) {
  if (!validateVsPeriod(weekEnding, "weekly")) throw new VsEvidenceError("invalid_period");
  const dates = Array.from({ length: 7 }, (_, index) => addCalendarDays(weekEnding, index - 6));
  const [heads, roster, scopes] = await Promise.all([
    listVsHeads(allianceId, { dates }),
    getDb().select({ id: schema.allianceMembers.ashedMemberId }).from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, allianceId)),
    getDb().select().from(schema.vsScoreSyncScopes).where(and(eq(schema.vsScoreSyncScopes.allianceId, allianceId), inArray(schema.vsScoreSyncScopes.recordedDate, dates))),
  ]);
  const byMember = new Map<string, VsEvidence[]>();
  const add = (memberId: string, evidence: VsEvidence) => { const rows = byMember.get(memberId) ?? []; rows.push(evidence); byMember.set(memberId, rows); };
  const local = new Map(heads.map((head) => [JSON.stringify([head.memberId, head.period, head.recordedDate]), head]));
  for (const head of heads) if (head.origin === "hq" && head.score != null) add(head.memberId, { id: `hq:${head.id}:${head.version}`, recordedDate: head.recordedDate, period: head.period, score: head.score });
  const rosterIds = new Set(roster.map((row) => row.id));
  let externalAvailable = false;
  try {
    const context = await resolveExcusedConnection(allianceId);
    if (context) {
      const snapshots = await Promise.all(dates.map(async (date) => ({ date, period: date === weekEnding ? "weekly" as const : "daily" as const, rows: await fetchRemoteVsScope(context, date, date === weekEnding ? "weekly" : "daily") })));
      for (const snapshot of snapshots) for (const row of snapshot.rows) {
        if (!rosterIds.has(row.memberId)) continue;
        const head = local.get(JSON.stringify([row.memberId, snapshot.period, snapshot.date]));
        if (head?.origin === "hq") continue;
        if (head?.origin === "derived") {
          const scope = scopes.find((scope) => scope.period === "daily" && scope.recordedDate === snapshot.date);
          const managed = scope?.managedScores && Object.hasOwn(scope.managedScores, row.memberId) ? scope.managedScores[row.memberId] : undefined;
          if (managed && (managed.desired === row.score || managed.previous === row.score)) continue;
        }
        add(row.memberId, { id: `ashed:${row.id}`, recordedDate: snapshot.date, period: snapshot.period, score: row.score });
      }
      externalAvailable = true;
    }
  } catch {
    externalAvailable = false;
  }
  const members = new Map<string, VsWeekEvidence>();
  for (const memberId of rosterIds) members.set(memberId, evaluateVsWeek(byMember.get(memberId) ?? [], weekEnding));
  return { weekEnding, members, externalAvailable };
}
