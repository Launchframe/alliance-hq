import "server-only";

import { and, asc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { appApiUrl, authHeaders } from "@/lib/base44/fetch";
import { resolveExcusedConnection, validateExcusedMember, type ExcusedConnection } from "@/lib/time-off/excused-transport.server";
import { ExcusedSyncError } from "@/lib/time-off/excused-sync.shared";
import { listVsHeads } from "./repository.server";
import { parseVsScore, type VsPeriod } from "./evidence.shared";

type Scope = typeof schema.vsScoreSyncScopes.$inferSelect;
type VsConnection = ExcusedConnection & { deadline?: number };
type RemoteScore = { id: string; memberId: string; score: number };

async function request(context: VsConnection, path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<unknown> {
  if (context.deadline && Date.now() >= context.deadline) throw new ExcusedSyncError("failed");
  const response = await fetch(appApiUrl(context.connection, path), {
    method, headers: { ...authHeaders(context.connection), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, (context.deadline ?? Date.now() + 10_000) - Date.now()))), cache: "no-store",
  });
  if (method === "DELETE" && response.status === 404) return null;
  if (response.status === 401 || response.status === 403) throw new ExcusedSyncError("credentials_required");
  if (!response.ok) throw new ExcusedSyncError("failed");
  if (method === "DELETE") return null;
  try { return await response.json(); } catch { throw new ExcusedSyncError("invalid_snapshot"); }
}

export async function fetchRemoteVsScope(context: VsConnection, recordedDate: string, period: VsPeriod): Promise<RemoteScore[]> {
  const result: RemoteScore[] = [];
  const seen = new Set<string>();
  let skip = 0;
  const deadline = Date.now() + 30_000;
  for (let page = 0; page < 50; page++) {
    if (Date.now() >= deadline) throw new ExcusedSyncError("failed");
    const params = new URLSearchParams({ q: JSON.stringify({ alliance_id: context.allianceId, recorded_date: recordedDate }), sort: "id", limit: "200", skip: String(skip) });
    const body = await request(context, `/entities/VSScore?${params}`, "GET");
    if (!Array.isArray(body)) throw new ExcusedSyncError("invalid_snapshot");
    if (!body.length) return result;
    skip += body.length;
    for (const value of body) {
      if (!value || typeof value !== "object") throw new ExcusedSyncError("invalid_snapshot");
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string" || !row.id || seen.has(row.id) || row.alliance_id !== context.allianceId || typeof row.member_id !== "string" || !row.member_id || typeof row.recorded_date !== "string" || row.recorded_date.slice(0, 10) !== recordedDate || row.is_weekly != null && typeof row.is_weekly !== "boolean") throw new ExcusedSyncError("invalid_snapshot");
      seen.add(row.id);
      if ((row.is_weekly === true) !== (period === "weekly")) continue;
      result.push({ id: row.id, memberId: row.member_id, score: parseVsScore(row.score) });
    }
  }
  throw new ExcusedSyncError("invalid_snapshot");
}

async function syncScope(scope: Scope, context: VsConnection) {
  const db = getDb();
  const token = nanoid();
  const [claimed] = await db.update(schema.vsScoreSyncScopes).set({ leaseToken: token, leaseExpiresAt: new Date(Date.now() + 180_000) })
    .where(and(eq(schema.vsScoreSyncScopes.id, scope.id), lte(schema.vsScoreSyncScopes.nextAttemptAt, new Date()), or(isNull(schema.vsScoreSyncScopes.leaseToken), lt(schema.vsScoreSyncScopes.leaseExpiresAt, new Date())))).returning();
  if (!claimed) return false;
  let status = "synced";
  try {
    const heads = await listVsHeads(scope.allianceId, { recordedDate: scope.recordedDate, period: scope.period });
    const remote = await fetchRemoteVsScope(context, scope.recordedDate, scope.period);
    const managed = Object.assign(Object.create(null), claimed.managedScores) as Scope["managedScores"];
    const owned = new Set(claimed.managedMemberIds);
    const eligible = heads.filter((head) => {
      if (head.origin === "hq") return true;
      const rows = remote.filter((row) => row.memberId === head.memberId);
      const previous = Object.hasOwn(managed, head.memberId) ? managed[head.memberId] : undefined;
      if (!rows.length || owned.has(head.memberId) && previous && rows.every((row) => row.score === previous.desired || row.score === previous.previous)) return true;
      owned.delete(head.memberId);
      delete managed[head.memberId];
      return false;
    });
    const changes = eligible.filter((head) => {
      const rows = remote.filter((row) => row.memberId === head.memberId);
      return head.score == null ? rows.length > 0 : !rows.length || rows.some((row) => row.score !== head.score);
    });
    for (const head of changes) if (head.score != null) {
      if (context.deadline && Date.now() > context.deadline - 10_000) throw new ExcusedSyncError("failed");
      await validateExcusedMember(context, head.memberId);
    }
    for (const head of eligible) {
      const previous = Object.hasOwn(managed, head.memberId) ? managed[head.memberId] : undefined;
      managed[head.memberId] = { previous: previous?.desired ?? null, desired: head.score };
      owned.add(head.memberId);
    }
    const [held] = await db.update(schema.vsScoreSyncScopes).set({ managedScores: { ...managed }, managedMemberIds: [...owned], leaseExpiresAt: new Date(Date.now() + 180_000) })
      .where(and(eq(schema.vsScoreSyncScopes.id, scope.id), eq(schema.vsScoreSyncScopes.leaseToken, token), gt(schema.vsScoreSyncScopes.leaseExpiresAt, new Date()))).returning({ id: schema.vsScoreSyncScopes.id });
    if (!held) throw new ExcusedSyncError("busy");
    for (const head of changes) {
      const rows = remote.filter((row) => row.memberId === head.memberId);
      if (head.score == null || new Set(rows.map((row) => row.score)).size > 1) {
        for (const row of rows) await request(context, `/entities/VSScore/${encodeURIComponent(row.id)}`, "DELETE");
      }
    }
    const scores = changes.filter((head) => head.score != null);
    if (scores.length) await request(context, "/functions/bulkUpsertVSScores", "POST", {
      alliance_id: context.allianceId, competition_id: scope.recordedDate, recorded_date: scope.recordedDate,
      is_weekly: scope.period === "weekly", scores: scores.map((head) => ({ member_id: head.memberId, member_name: head.memberName, score: head.score })), unmatched: [], alliance_size_at_record: null,
    });
    const verified = changes.length ? await fetchRemoteVsScope(context, scope.recordedDate, scope.period) : remote;
    for (const head of eligible) {
      const rows = verified.filter((row) => row.memberId === head.memberId);
      if (head.score == null ? rows.length !== 0 : !rows.length || rows.some((row) => row.score !== head.score)) throw new ExcusedSyncError("failed");
    }
  } catch (error) {
    status = error instanceof ExcusedSyncError && error.code === "credentials_required" ? "credentials_required" : "failed";
  } finally {
    await db.update(schema.vsScoreSyncScopes).set({
      leaseToken: null, leaseExpiresAt: null,
      status: sql`case when ${schema.vsScoreSyncScopes.requestedVersion} > ${claimed.requestedVersion} then 'pending' else ${status} end`,
      processedVersion: status === "synced" ? claimed.requestedVersion : claimed.processedVersion,
      nextAttemptAt: sql`case when ${schema.vsScoreSyncScopes.requestedVersion} > ${claimed.requestedVersion} then to_timestamp(0) else ${new Date(Date.now() + (status === "synced" ? 300_000 : 60_000)).toISOString()}::timestamptz end`,
      ...(status === "synced" ? { lastSyncedAt: new Date() } : {}),
    }).where(and(eq(schema.vsScoreSyncScopes.id, scope.id), eq(schema.vsScoreSyncScopes.leaseToken, token)));
  }
  return true;
}

export async function syncVsScoresForAlliance(allianceId: string) {
  const db = getDb();
  const due = await db.select().from(schema.vsScoreSyncScopes).where(and(eq(schema.vsScoreSyncScopes.allianceId, allianceId), lte(schema.vsScoreSyncScopes.nextAttemptAt, new Date()), sql`(${schema.vsScoreSyncScopes.status} <> 'synced' or ${schema.vsScoreSyncScopes.requestedVersion} > ${schema.vsScoreSyncScopes.processedVersion})`))
    .orderBy(asc(schema.vsScoreSyncScopes.nextAttemptAt), asc(schema.vsScoreSyncScopes.recordedDate)).limit(2);
  if (!due.length) return;
  let context: ExcusedConnection | null;
  try { context = await resolveExcusedConnection(allianceId); }
  catch {
    await db.update(schema.vsScoreSyncScopes).set({ status: "credentials_required", nextAttemptAt: new Date(Date.now() + 60_000) })
      .where(and(eq(schema.vsScoreSyncScopes.allianceId, allianceId), isNull(schema.vsScoreSyncScopes.leaseToken)));
    return;
  }
  if (!context) return;
  const bounded = { ...context, deadline: Date.now() + 130_000 };
  for (const scope of due) {
    if (Date.now() >= bounded.deadline) break;
    await syncScope(scope, bounded);
  }
}

export async function runVsScoreSyncTick() {
  const [scope] = await getDb().select({ allianceId: schema.vsScoreSyncScopes.allianceId }).from(schema.vsScoreSyncScopes)
    .innerJoin(schema.alliances, eq(schema.alliances.id, schema.vsScoreSyncScopes.allianceId))
    .where(and(eq(schema.alliances.operatingMode, "ashed"), lte(schema.vsScoreSyncScopes.nextAttemptAt, new Date()), sql`(${schema.vsScoreSyncScopes.status} <> 'synced' or ${schema.vsScoreSyncScopes.requestedVersion} > ${schema.vsScoreSyncScopes.processedVersion})`, or(isNull(schema.vsScoreSyncScopes.leaseToken), lt(schema.vsScoreSyncScopes.leaseExpiresAt, new Date()))))
    .orderBy(asc(schema.vsScoreSyncScopes.nextAttemptAt)).limit(1);
  if (scope) await syncVsScoresForAlliance(scope.allianceId);
}
