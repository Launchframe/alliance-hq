import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { resolveExcusedConnection, fetchExcusedSnapshot } from "@/lib/time-off/excused-transport.server";
import { timeOffExcusesDate } from "@/lib/time-off/workflow.shared";
import type { ExcusedRecord } from "@/lib/time-off/excused-sync.shared";
import { evaluateVsWeek, type VsEvidence } from "@/lib/vs-scores/evidence.shared";
import { fetchRemoteVsScope } from "@/lib/vs-scores/sync.server";
import { resolveComplianceJoin } from "./workflow.shared";
import type { VsComplianceDay, VsComplianceMember, VsComplianceWeek } from "./types.shared";

export type ComplianceTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type ExternalComplianceEvidence = { native: boolean; verifiedAt: Date | null; weeks: Map<string, Map<string, VsEvidence[]>>; excuses: ExcusedRecord[] };

export async function prepareExternalEvidence(allianceId: string, weeks: string[]): Promise<ExternalComplianceEvidence> {
  const [alliance] = await getDb().select({ mode: schema.alliances.operatingMode }).from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
  const result: ExternalComplianceEvidence = { native: alliance?.mode === "native", verifiedAt: null, weeks: new Map(), excuses: [] };
  if (result.native) return result;
  try {
    const connection = await resolveExcusedConnection(allianceId);
    if (!connection) return result;
    const deadline = Date.now() + 90_000;
    result.excuses = (await fetchExcusedSnapshot(connection, deadline)).map((row) => ({ ...row, reason: null }));
    for (const week of weeks) {
      if (Date.now() > deadline) break;
      const members = new Map<string, VsEvidence[]>();
      const snapshots = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
        const date = addCalendarDays(week, index - 6);
        const period = index === 6 ? "weekly" as const : "daily" as const;
        return { date, period, rows: await fetchRemoteVsScope(connection, date, period) };
      }));
      for (const scope of snapshots) for (const row of scope.rows) {
        const list = members.get(row.memberId) ?? [];
        list.push({ id: `ashed:${row.id}`, recordedDate: scope.date, period: scope.period, score: row.score });
        members.set(row.memberId, list);
      }
      result.weeks.set(week, members);
    }
    result.verifiedAt = new Date();
  } catch {
    result.verifiedAt = null;
  }
  return result;
}

export async function lockCompliance(tx: ComplianceTx, allianceId: string) {
  await tx.insert(schema.vsComplianceState).values({ allianceId }).onConflictDoNothing();
  const [state] = await tx.select().from(schema.vsComplianceState).where(eq(schema.vsComplianceState.allianceId, allianceId)).for("update");
  return state;
}

export async function loadComplianceFacts(tx: ComplianceTx, allianceId: string) {
  const [alliance] = await tx.select().from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
  const policies = await tx.select().from(schema.vsCompliancePolicies).where(eq(schema.vsCompliancePolicies.allianceId, allianceId));
  const roster = await tx.select({ memberId: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName, status: schema.allianceMembers.status, rank: schema.allianceMembers.allianceRank, joinDate: schema.allianceMembers.joinDate, updatedAt: schema.allianceMembers.updatedAt }).from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, allianceId));
  const tenure = await tx.select({ memberId: schema.memberAllianceTenure.ashedMemberId, joinedAt: schema.memberAllianceTenure.joinedAt, leftAt: schema.memberAllianceTenure.leftAt }).from(schema.memberAllianceTenure).where(eq(schema.memberAllianceTenure.allianceId, allianceId));
  const memberships = await tx.select({ memberId: schema.commanderAllianceMemberships.ashedMemberId, joinedAt: schema.commanderAllianceMemberships.joinedAt, leftAt: schema.commanderAllianceMemberships.leftAt, status: schema.commanderAllianceMemberships.status }).from(schema.commanderAllianceMemberships).where(eq(schema.commanderAllianceMemberships.allianceId, allianceId));
  const ranks = await tx.select().from(schema.memberAllianceRankEvents).where(eq(schema.memberAllianceRankEvents.allianceId, allianceId)).orderBy(sql`${schema.memberAllianceRankEvents.recordedAt} desc`, sql`${schema.memberAllianceRankEvents.id} desc`);
  const heads = await tx.select().from(schema.vsScoreHeads).where(eq(schema.vsScoreHeads.allianceId, allianceId));
  const scopes = await tx.select().from(schema.vsScoreSyncScopes).where(eq(schema.vsScoreSyncScopes.allianceId, allianceId));
  const entries = await tx.select({ id: schema.memberTimeOff.id, memberId: schema.memberTimeOff.ashedMemberId, startDate: schema.memberTimeOff.startDate, endDate: schema.memberTimeOff.endDate, globalAbsence: schema.memberTimeOff.globalAbsence, noticeVerified: schema.memberTimeOff.noticeVerified, syncStatus: schema.memberTimeOff.syncStatus, cancelledAt: schema.memberTimeOff.cancelledAt }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.allianceId, allianceId));
  const revisions = await tx.select({ entryId: schema.memberTimeOffRevisions.entryId, version: schema.memberTimeOffRevisions.version, snapshot: schema.memberTimeOffRevisions.snapshot, recordedAt: schema.memberTimeOffRevisions.recordedAt }).from(schema.memberTimeOffRevisions).where(eq(schema.memberTimeOffRevisions.allianceId, allianceId));
  const members = roster.map((row) => {
    const currentStints = [...tenure.filter((t) => t.memberId === row.memberId && !t.leftAt), ...memberships.filter((m) => m.memberId === row.memberId && !m.leftAt && m.status === "active")];
    const latestRank = ranks.find((rank) => rank.ashedMemberId === row.memberId && rank.effectiveDate <= getServerCalendarDate());
    const currentRank = latestRank && latestRank.recordedAt > row.updatedAt ? latestRank.allianceRank : row.rank;
    const member: VsComplianceMember = {
      active: row.status === "active", currentRank,
      joinedAt: resolveComplianceJoin(currentStints.map((stint) => stint.joinedAt.toISOString()), row.joinDate), leftAt: null,
      rankVersion: JSON.stringify([latestRank?.id ?? null, latestRank?.allianceRank ?? null, row.rank, row.status, row.updatedAt.toISOString()]),
      isOwner: alliance?.ownerMemberExternalId === row.memberId,
    };
    return { ...row, member };
  });
  return { alliance, policies, members, heads, scopes, entries, revisions };
}

export function resolveComplianceEvidence(facts: Awaited<ReturnType<typeof loadComplianceFacts>>, memberId: string, weekEnding: string, external: ExternalComplianceEvidence, previousRemote: VsEvidence[] = [], previousVerifiedAt: Date | null = null) {
  const dates = Array.from({ length: 6 }, (_, index) => addCalendarDays(weekEnding, index - 6));
  const heads = facts.heads.filter((head) => head.memberId === memberId && (head.recordedDate === weekEnding || dates.includes(head.recordedDate)));
  const records: VsEvidence[] = heads.filter((head) => head.origin === "hq" && head.score != null).map((head) => ({ id: `hq:${head.id}:${head.version}`, recordedDate: head.recordedDate, period: head.period, score: head.score! }));
  const fetched = external.weeks.get(weekEnding);
  const remote = fetched ? fetched.get(memberId) ?? [] : previousRemote;
  for (const row of remote) {
    const local = heads.find((head) => head.period === row.period && head.recordedDate === row.recordedDate);
    if (local?.origin === "hq") continue;
    const managed = facts.scopes.find((scope) => scope.recordedDate === row.recordedDate && scope.period === row.period)?.managedScores?.[memberId];
    if (local?.origin === "derived" && managed && (managed.previous === row.score || managed.desired === row.score)) continue;
    records.push(row);
  }
  const memberEntries = facts.entries.filter((entry) => entry.memberId === memberId).map((entry) => ({
    ...entry,
    revisions: facts.revisions.filter((revision) => revision.entryId === entry.id).sort((a, b) => a.version - b.version).map((revision) => ({ snapshot: revision.snapshot, recordedAt: revision.recordedAt.toISOString() })),
  }));
  const remoteExcuses = external.excuses.filter((row) => row.memberId === memberId && row.recordType === "vs");
  const verifiedAt = fetched ? external.verifiedAt : previousVerifiedAt;
  const sourceUnknown = !external.native && (!external.verifiedAt || !verifiedAt);
  const evidence = evaluateVsWeek(records, weekEnding);
  const daily: VsComplianceDay[] = dates.map((date, index) => {
    const rows = records.filter((row) => row.period === "daily" && row.recordedDate === date);
    const local = heads.find((head) => head.period === "daily" && head.recordedDate === date && head.origin === "hq");
    const derived = index === 5 && !local ? evidence.derivedSaturday : null;
    const conflicting = rows.some((row) => !Number.isSafeInteger(row.score) || row.score < 0 || row.score !== rows[0].score);
    const source = rows.length ? local ? "hq" : "ashed" : derived ? "derived" : null;
    const sourceReady = external.native || !!verifiedAt || source === "hq" || source === "derived" && evidence.derivedSaturday!.basis.every((id) => id.startsWith("hq:"));
    const state = conflicting ? "conflict" : !rows.length && !derived ? "missing" : !sourceReady ? "partial" : "ready";
    return {
      date, score: state === "ready" ? rows[0]?.score ?? derived?.score ?? null : null, state, source, sourceReady,
      away: memberEntries.some((entry) => !entry.cancelledAt && entry.globalAbsence && entry.startDate <= date && date <= entry.endDate),
      excused: memberEntries.some((entry) => timeOffExcusesDate(entry.revisions, date, "vs")) || remoteExcuses.some((row) => row.startDate <= date && row.endDate >= date && !!row.changedAt && Date.parse(row.changedAt) < Date.parse(`${date}T02:00:00.000Z`)),
      pendingExcusal: sourceUnknown || memberEntries.some((entry) => !entry.cancelledAt && entry.startDate <= date && entry.endDate >= date && (!entry.noticeVerified || ["conflict", "uncertain", "failed", "credentials_required"].includes(entry.syncStatus))) || remoteExcuses.some((row) => !row.changedAt && row.startDate <= date && row.endDate >= date),
    };
  });
  if (!external.native && !verifiedAt && records.some((row) => row.id.startsWith("ashed:"))) { evidence.state = "partial"; evidence.score = null; }
  return { evidence, daily, excused: daily.some((day) => day.excused), pendingExcusal: daily.some((day) => day.pendingExcusal) };
}

export function assembleComplianceWeek(facts: Awaited<ReturnType<typeof loadComplianceFacts>>, memberId: string, weekEnding: string, external: ExternalComplianceEvidence, previousRemote: VsEvidence[] = [], previousVerifiedAt: Date | null = null): VsComplianceWeek {
  const { evidence, excused, pendingExcusal } = resolveComplianceEvidence(facts, memberId, weekEnding, external, previousRemote, previousVerifiedAt);
  return { weekEnding, evidence, excused, pendingExcusal, waived: false };
}

export async function loadComplianceStateVersion(allianceId: string): Promise<number> {
  const [row] = await getDb().select({ version: schema.vsComplianceState.inputVersion }).from(schema.vsComplianceState).where(and(eq(schema.vsComplianceState.allianceId, allianceId)));
  return row?.version ?? 0;
}
