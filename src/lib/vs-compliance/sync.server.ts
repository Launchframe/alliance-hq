import "server-only";

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { appApiUrl, authHeaders } from "@/lib/base44/fetch";
import { formatAshedMemberRankValue, readAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import { resolveExcusedConnection, type ExcusedConnection } from "@/lib/time-off/excused-transport.server";
import { lockCompliance } from "./evidence.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { planComplianceMirror } from "./workflow.shared";

async function readRemoteMember(context: ExcusedConnection, memberId: string) {
  const response = await fetch(appApiUrl(context.connection, `/entities/Member/${encodeURIComponent(memberId)}`), { headers: authHeaders(context.connection), signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) throw new Error("failed");
  const row: unknown = await response.json();
  if (!row || typeof row !== "object" || !("id" in row) || row.id !== memberId || !("alliance_id" in row) || row.alliance_id !== context.allianceId || !("status" in row) || typeof row.status !== "string") throw new Error("failed");
  return { rank: readAshedMemberAllianceRank(row as Record<string, unknown>), status: row.status };
}

export async function complianceSyncStatus(allianceId: string, actionId: string) {
  const [job] = await getDb().select({ status: schema.vsComplianceSyncJobs.status }).from(schema.vsComplianceSyncJobs).where(and(eq(schema.vsComplianceSyncJobs.allianceId, allianceId), eq(schema.vsComplianceSyncJobs.actionId, actionId)));
  return job?.status ?? "failed";
}

export async function syncComplianceAction(allianceId: string, actionId: string) {
  const leaseToken = nanoid();
  const claimed = await getDb().transaction(async (tx) => {
    await lockCompliance(tx, allianceId);
    const [job] = await tx.select().from(schema.vsComplianceSyncJobs).where(and(eq(schema.vsComplianceSyncJobs.allianceId, allianceId), eq(schema.vsComplianceSyncJobs.actionId, actionId))).for("update");
    if (!job || job.supersededAt || ["local", "synced"].includes(job.status) || job.leaseExpiresAt && job.leaseExpiresAt > new Date()) return null;
    const [action] = await tx.select().from(schema.vsComplianceActions).where(and(eq(schema.vsComplianceActions.allianceId, allianceId), eq(schema.vsComplianceActions.id, actionId)));
    const [roster] = await tx.select().from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.ashedMemberId, job.memberId)));
    const [guard] = await tx.select().from(schema.vsComplianceRosterGuards).where(and(eq(schema.vsComplianceRosterGuards.allianceId, allianceId), eq(schema.vsComplianceRosterGuards.memberId, job.memberId)));
    const newerRanks = action ? await tx.select({ id: schema.memberAllianceRankEvents.id, rank: schema.memberAllianceRankEvents.allianceRank, ashedSyncedAt: schema.memberAllianceRankEvents.ashedSyncedAt, recordedAt: schema.memberAllianceRankEvents.recordedAt }).from(schema.memberAllianceRankEvents).where(and(eq(schema.memberAllianceRankEvents.allianceId, allianceId), eq(schema.memberAllianceRankEvents.ashedMemberId, job.memberId), gt(schema.memberAllianceRankEvents.recordedAt, action.recordedAt), sql`${schema.memberAllianceRankEvents.effectiveDate} <= ${getServerCalendarDate()}`)) : [];
    if (!action || !roster || guard?.actionId !== actionId || newerRanks.length || roster.allianceRank !== (action.kind === "remove" ? action.expectedRank : action.targetRank) || roster.status !== (action.kind === "remove" ? "former" : "active")) {
      const newerRank = newerRanks.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0];
      let supersededBy = roster?.status === "active" && newerRank?.ashedSyncedAt && newerRank.rank === roster.allianceRank ? `rank:${newerRank.id}` : null;
      if (guard && guard.actionId !== actionId && roster?.allianceRank === guard.rank && roster.status === guard.status) {
        const [newerJob] = await tx.select().from(schema.vsComplianceSyncJobs).where(and(eq(schema.vsComplianceSyncJobs.allianceId, allianceId), eq(schema.vsComplianceSyncJobs.actionId, guard.actionId)));
        if (newerJob && ["local", "synced"].includes(newerJob.status)) supersededBy = `action:${guard.actionId}`;
      }
      await tx.update(schema.vsComplianceSyncJobs).set({ status: "failed", nextAttemptAt: new Date(Date.now() + 3600_000), leaseToken: null, leaseExpiresAt: null, supersededAt: supersededBy ? new Date() : null, supersededBy }).where(eq(schema.vsComplianceSyncJobs.actionId, actionId));
      if (supersededBy && action) await tx.update(schema.vsComplianceState).set({ requestedFrom: sql`least(${schema.vsComplianceState.requestedFrom}, (select week_ending from vs_compliance_evaluations where id = ${action.eventId} and alliance_id = ${allianceId}))`, nextAttemptAt: new Date() }).where(eq(schema.vsComplianceState.allianceId, allianceId));
      return null;
    }
    await tx.update(schema.vsComplianceSyncJobs).set({ leaseToken, leaseExpiresAt: new Date(Date.now() + 180_000), attempts: job.attempts + 1 }).where(eq(schema.vsComplianceSyncJobs.actionId, actionId));
    return action;
  });
  if (!claimed) return complianceSyncStatus(allianceId, actionId);
  let status: "synced" | "failed" | "credentials_required" = "failed";
  try {
    const context = await resolveExcusedConnection(allianceId);
    if (!context) status = "credentials_required";
    else {
      const remote = await readRemoteMember(context, claimed.memberId);
      const plan = planComplianceMirror(claimed, remote);
      if (plan === "write_rank") {
        const [lease] = await getDb().select({ token: schema.vsComplianceSyncJobs.leaseToken, expiry: schema.vsComplianceSyncJobs.leaseExpiresAt }).from(schema.vsComplianceSyncJobs).where(and(eq(schema.vsComplianceSyncJobs.allianceId, allianceId), eq(schema.vsComplianceSyncJobs.actionId, actionId)));
        if (lease?.token !== leaseToken || !lease.expiry || lease.expiry.getTime() - Date.now() < 30_000) throw new Error("failed");
        const response = await fetch(appApiUrl(context.connection, `/entities/Member/${encodeURIComponent(claimed.memberId)}`), { method: "PUT", headers: { ...authHeaders(context.connection), "Content-Type": "application/json" }, body: JSON.stringify({ rank: formatAshedMemberRankValue(claimed.targetRank!) }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
        if (!response.ok) throw new Error("failed");
        if (planComplianceMirror(claimed, await readRemoteMember(context, claimed.memberId)) !== "verified") throw new Error("failed");
        status = "synced";
      } else if (plan === "verified") status = "synced";
    }
  } catch (error) {
    status = error && typeof error === "object" && "code" in error && error.code === "credentials_required" ? "credentials_required" : "failed";
  }
  await getDb().transaction(async (tx) => {
    await lockCompliance(tx, allianceId);
    const [job] = await tx.select().from(schema.vsComplianceSyncJobs).where(and(eq(schema.vsComplianceSyncJobs.allianceId, allianceId), eq(schema.vsComplianceSyncJobs.actionId, actionId))).for("update");
    if (job?.leaseToken !== leaseToken) return;
    await tx.update(schema.vsComplianceSyncJobs).set({ status, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date(Date.now() + 60_000), syncedAt: status === "synced" ? new Date() : null }).where(eq(schema.vsComplianceSyncJobs.actionId, actionId));
    if (status === "synced" && claimed.kind === "demote") await tx.update(schema.memberAllianceRankEvents).set({ ashedSyncedAt: new Date() }).where(and(eq(schema.memberAllianceRankEvents.allianceId, allianceId), eq(schema.memberAllianceRankEvents.id, actionId)));
    await tx.update(schema.vsComplianceState).set({ requestedFrom: sql`least(${schema.vsComplianceState.requestedFrom}, (select week_ending from vs_compliance_evaluations where id = ${claimed.eventId} and alliance_id = ${allianceId}))`, nextAttemptAt: new Date() }).where(eq(schema.vsComplianceState.allianceId, allianceId));
  });
  return status;
}

export async function retryComplianceSync(limit = 5) {
  const jobs = await getDb().select().from(schema.vsComplianceSyncJobs).where(and(isNull(schema.vsComplianceSyncJobs.supersededAt), sql`${schema.vsComplianceSyncJobs.status} not in ('local', 'synced')`, sql`${schema.vsComplianceSyncJobs.nextAttemptAt} <= now()`, or(isNull(schema.vsComplianceSyncJobs.leaseExpiresAt), sql`${schema.vsComplianceSyncJobs.leaseExpiresAt} <= now()`))).limit(limit);
  for (const job of jobs) await syncComplianceAction(job.allianceId, job.actionId);
  return jobs.length;
}
