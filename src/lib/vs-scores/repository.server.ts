import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays } from "@/lib/trains/game-time";
import { buildReviewOutcomePatch } from "@/lib/video/video-hygiene-instrumentation.shared";
import { computeQualityScore } from "@/lib/video/quality-score";
import { evaluateVsWeek, parseVsScore, validateVsPeriod, vsWeekEndingDate, VsEvidenceError, type VsPeriod } from "./evidence.shared";

export type VsTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type VsHead = typeof schema.vsScoreHeads.$inferSelect;
export type VsReviewRow = { id: string; memberId?: string | null; memberName?: string | null; score?: unknown; rank?: number | null; deleted?: boolean };
type MutationContext = {
  tx: VsTransaction; allianceId: string; actorId: string; mirror: boolean;
  original: Map<string, VsHead>; heads: Map<string, VsHead>; changes: Map<string, VsHead>;
  weeks: Set<string>; dates: string[];
};
const keyFor = (row: Pick<VsHead, "memberId" | "period" | "recordedDate">) => JSON.stringify([row.memberId, row.period, row.recordedDate]);

async function lockAlliance(tx: VsTransaction, allianceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`vs-evidence:${allianceId}`}))`);
}

async function mutationContext(tx: VsTransaction, allianceId: string, actorId: string, dates: string[]): Promise<MutationContext> {
  const weeks = new Set(dates.map(vsWeekEndingDate));
  const allDates = [...weeks].flatMap((week) => Array.from({ length: 7 }, (_, index) => addCalendarDays(week, index - 6)));
  const rows = allDates.length ? await tx.select().from(schema.vsScoreHeads).where(and(eq(schema.vsScoreHeads.allianceId, allianceId), inArray(schema.vsScoreHeads.recordedDate, allDates))) : [];
  const [alliance] = await tx.select({ mode: schema.alliances.operatingMode, externalId: schema.alliances.ashedAllianceId }).from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
  if (!alliance) throw new VsEvidenceError("forbidden", 403);
  const original = new Map(rows.map((row) => [keyFor(row), row]));
  return { tx, allianceId, actorId, mirror: alliance.mode === "ashed" && !!alliance.externalId, original, heads: new Map(original), changes: new Map(), weeks, dates };
}

function setHead(context: MutationContext, next: Pick<VsHead, "memberId" | "memberName" | "period" | "recordedDate" | "score" | "origin" | "batchId" | "sourceJobId" | "basis">) {
  const key = keyFor(next);
  const original = context.original.get(key);
  if (original && original.score === next.score && original.origin === next.origin && original.batchId === next.batchId && original.sourceJobId === next.sourceJobId && original.memberName === next.memberName && JSON.stringify(original.basis) === JSON.stringify(next.basis)) {
    context.changes.delete(key); context.heads.set(key, original); return;
  }
  const head: VsHead = { ...next, id: original?.id ?? context.heads.get(key)?.id ?? nanoid(), allianceId: context.allianceId, version: (original?.version ?? 0) + 1, updatedAt: new Date() };
  context.heads.set(key, head); context.changes.set(key, head);
}

function recomputeSaturdays(context: MutationContext) {
  for (const week of context.weeks) {
    const saturday = addCalendarDays(week, -1);
    const rows = [...context.heads.values()].filter((row) => vsWeekEndingDate(row.recordedDate) === week);
    for (const memberId of new Set(rows.map((row) => row.memberId))) {
      const own = rows.filter((row) => row.memberId === memberId);
      const previous = own.find((row) => row.period === "daily" && row.recordedDate === saturday);
      if (previous?.origin === "hq" && previous.score != null) continue;
      const raw = own.filter((row) => row.origin === "hq" && row.score != null);
      const result = evaluateVsWeek(raw.map((row) => ({ id: row.id, period: row.period, recordedDate: row.recordedDate, score: row.score! })), week);
      const weekly = raw.find((row) => row.period === "weekly" && row.recordedDate === week);
      if (result.derivedSaturday && weekly) {
        setHead(context, {
          memberId, memberName: weekly.memberName, period: "daily", recordedDate: saturday,
          score: result.derivedSaturday.score, origin: "derived", batchId: weekly.batchId, sourceJobId: weekly.sourceJobId,
          basis: result.derivedSaturday.basis.map((id) => { const head = raw.find((row) => row.id === id)!; return { id, version: head.version }; }),
        });
      } else if (previous?.origin === "derived" && previous.score != null) {
        setHead(context, { ...previous, score: null, basis: [] });
      }
    }
  }
}

async function persistHeadChanges(context: MutationContext, changes: VsHead[]) {
  const saved = await context.tx.insert(schema.vsScoreHeads).values(changes).onConflictDoUpdate({
    target: [schema.vsScoreHeads.allianceId, schema.vsScoreHeads.memberId, schema.vsScoreHeads.period, schema.vsScoreHeads.recordedDate],
    set: {
      score: sql`excluded.score`, origin: sql`excluded.origin`, version: sql`excluded.version`, memberName: sql`excluded.member_name`,
      batchId: sql`excluded.batch_id`, sourceJobId: sql`excluded.source_job_id`, basis: sql`excluded.basis`, updatedAt: sql`excluded.updated_at`,
    }, setWhere: sql`${schema.vsScoreHeads.version} = excluded.version - 1`,
  }).returning({ id: schema.vsScoreHeads.id });
  if (saved.length !== changes.length) throw new VsEvidenceError("stale", 409);
  await context.tx.insert(schema.vsScoreRevisions).values(changes.map((row) => ({
    id: nanoid(), headId: row.id, allianceId: context.allianceId, version: row.version, score: row.score,
    origin: row.origin, batchId: row.batchId, sourceJobId: row.sourceJobId, basis: row.basis,
    recordedByHqUserId: context.actorId, recordedAt: row.updatedAt,
  })));
}

async function persistMutation(context: MutationContext) {
  recomputeSaturdays(context);
  const changes = [...context.changes.values()];
  if (changes.length) await persistHeadChanges(context, changes);
  if (context.mirror) {
    const candidates = [...context.heads.values()].filter((row) => context.dates.includes(row.recordedDate) || row.origin === "derived");
    const scopes = new Map(candidates.map((row) => [JSON.stringify([row.period, row.recordedDate]), row]));
    for (const row of scopes.values()) await context.tx.insert(schema.vsScoreSyncScopes).values({ id: nanoid(), allianceId: context.allianceId, recordedDate: row.recordedDate, period: row.period, nextAttemptAt: new Date(0) })
      .onConflictDoUpdate({ target: [schema.vsScoreSyncScopes.allianceId, schema.vsScoreSyncScopes.period, schema.vsScoreSyncScopes.recordedDate], set: { requestedVersion: sql`${schema.vsScoreSyncScopes.requestedVersion} + 1`, status: "pending", nextAttemptAt: new Date(0) } });
  }
}

export async function loadVsJobContext(allianceId: string, jobId: string) {
  const [batch] = await getDb().select({ context: schema.dataUploadBatches.contextJson, date: schema.dataUploadBatches.recordedDate }).from(schema.dataUploadBatches)
    .where(and(eq(schema.dataUploadBatches.allianceId, allianceId), eq(schema.dataUploadBatches.sourceJobId, jobId), eq(schema.dataUploadBatches.scoreTarget, "vs-performance")))
    .orderBy(desc(sql`coalesce((${schema.dataUploadBatches.contextJson}->>'vsRevision')::integer, 0)`)).limit(1);
  return { vsRevision: typeof batch?.context.vsRevision === "number" ? batch.context.vsRevision : 0, vsPeriod: batch?.context.vsPeriod === "weekly" ? "weekly" as const : "daily" as const, ...(batch ? { recordedDate: batch.date } : {}) };
}

async function currentSyncStatus(tx: VsTransaction, allianceId: string, recordedDate: string, period: VsPeriod, mirror: boolean) {
  if (!mirror) return "local";
  const [scope] = await tx.select().from(schema.vsScoreSyncScopes).where(and(eq(schema.vsScoreSyncScopes.allianceId, allianceId), eq(schema.vsScoreSyncScopes.recordedDate, recordedDate), eq(schema.vsScoreSyncScopes.period, period))).limit(1);
  return scope?.status === "synced" && scope.processedVersion === scope.requestedVersion ? "synced" : "pending";
}

export async function commitReviewedVsScores(input: {
  allianceId: string; hqUserId: string; jobId: string; parseSessionId: string | null;
  recordedDate: string; period: VsPeriod; expectedRevision?: number; requestId: string; rows: VsReviewRow[];
}) {
  if (!input.hqUserId) throw new VsEvidenceError("forbidden", 403);
  if (!validateVsPeriod(input.recordedDate, input.period)) throw new VsEvidenceError("invalid_period");
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 300 || typeof input.requestId !== "string" || input.requestId.length < 8 || input.requestId.length > 100) throw new VsEvidenceError("invalid_rows");
  const active = input.rows.filter((row) => !row.deleted).map((row) => ({ ...row, scoreValue: parseVsScore(row.score) }));
  if (!active.length || active.some((row) => !row.memberId) || new Set(active.map((row) => row.memberId)).size !== active.length || new Set(input.rows.map((row) => row.id)).size !== input.rows.length) throw new VsEvidenceError("invalid_rows");
  const digest = createHash("sha256").update(JSON.stringify([input.recordedDate, input.period, active.map((row) => [row.id, row.memberId, row.scoreValue, row.rank ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), input.rows.filter((row) => row.deleted).map((row) => row.id).sort()])).digest("hex");
  return getDb().transaction(async (tx) => {
    await lockAlliance(tx, input.allianceId);
    const [alliance] = await tx.select().from(schema.alliances).where(eq(schema.alliances.id, input.allianceId)).limit(1);
    const [job] = await tx.select().from(schema.videoJobs).where(eq(schema.videoJobs.id, input.jobId)).limit(1).for("update");
    if (!alliance || !job || !job.allianceId || ![input.allianceId, alliance.ashedAllianceId].includes(job.allianceId) || (job.scoreTarget ?? job.category) !== "vs-performance") throw new VsEvidenceError("forbidden", 403);
    if (!input.parseSessionId || job.parseSessionId !== input.parseSessionId || !["review", "complete"].includes(job.status)) throw new VsEvidenceError("stale", 409);
    const batches = await tx.select().from(schema.dataUploadBatches).where(eq(schema.dataUploadBatches.sourceJobId, input.jobId))
      .orderBy(desc(sql`coalesce((${schema.dataUploadBatches.contextJson}->>'vsRevision')::integer, 0)`)).for("update");
    if (batches.some((batch) => batch.allianceId !== input.allianceId)) throw new VsEvidenceError("forbidden", 403);
    const previous = batches[0];
    const meta = previous?.contextJson ?? {};
    const revision = typeof meta.vsRevision === "number" ? meta.vsRevision : 0;
    const [receipt] = await tx.select().from(schema.vsScoreSubmissions).where(and(eq(schema.vsScoreSubmissions.allianceId, input.allianceId), eq(schema.vsScoreSubmissions.sourceJobId, input.jobId), eq(schema.vsScoreSubmissions.requestId, input.requestId))).limit(1);
    if (receipt) {
      if (receipt.digest !== digest || receipt.revision !== revision) throw new VsEvidenceError("stale", 409);
      return { submitted: receipt.rowCount, batchId: receipt.batchId, vsRevision: receipt.revision, syncStatus: await currentSyncStatus(tx, input.allianceId, input.recordedDate, input.period, alliance.operatingMode === "ashed" && !!alliance.ashedAllianceId) };
    }
    if (meta.vsRequestId === input.requestId) {
      if (meta.vsDigest !== digest) throw new VsEvidenceError("stale", 409);
      return { submitted: previous!.rowCount, batchId: previous!.id, vsRevision: revision, syncStatus: await currentSyncStatus(tx, input.allianceId, input.recordedDate, input.period, alliance.operatingMode === "ashed" && !!alliance.ashedAllianceId) };
    }
    if (revision > 0 && input.expectedRevision == null) throw new VsEvidenceError("stale", 409);
    if (input.expectedRevision != null && input.expectedRevision !== revision) throw new VsEvidenceError("stale", 409);
    const parsed = await tx.select().from(schema.parsedRows).where(eq(schema.parsedRows.parseSessionId, input.parseSessionId));
    const parsedIds = new Set(parsed.map((row) => row.id));
    if (input.rows.some((row) => !parsedIds.has(row.id))) throw new VsEvidenceError("invalid_rows");
    const roster = await tx.select({ id: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName, status: schema.allianceMembers.status }).from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, input.allianceId));
    const names = new Map(roster.filter((row) => row.status !== "former").map((row) => [row.id, row.name]));
    if (active.some((row) => !names.has(row.memberId!))) throw new VsEvidenceError("invalid_member");
    const old = await tx.select().from(schema.vsScoreHeads).where(and(eq(schema.vsScoreHeads.allianceId, input.allianceId), eq(schema.vsScoreHeads.sourceJobId, input.jobId), eq(schema.vsScoreHeads.origin, "hq"), isNotNull(schema.vsScoreHeads.score)));
    const context = await mutationContext(tx, input.allianceId, input.hqUserId, [input.recordedDate, ...old.map((row) => row.recordedDate)]);
    const now = new Date();
    const reuseBatch = previous?.status === "active" && previous.recordedDate === input.recordedDate && previous.contextJson.vsPeriod === input.period;
    const batchId = reuseBatch ? previous.id : nanoid(16);
    if (previous?.status === "active" && !reuseBatch) await tx.update(schema.dataUploadBatches).set({ status: "moved", movedToDate: input.recordedDate, updatedAt: now }).where(eq(schema.dataUploadBatches.id, previous.id));
    const batchValues = {
      recordedDate: input.recordedDate, contextJson: { storage: "hq", vsPeriod: input.period, vsRevision: revision + 1, vsDigest: digest, vsRequestId: input.requestId },
      rowCount: active.length, submittedAt: now, status: "active", updatedAt: now, movedToDate: null, deletedAt: null,
    };
    if (reuseBatch) await tx.update(schema.dataUploadBatches).set(batchValues).where(eq(schema.dataUploadBatches.id, batchId));
    else await tx.insert(schema.dataUploadBatches).values({ ...batchValues, id: batchId, allianceId: input.allianceId, scoreTarget: "vs-performance", submitEntity: "VSScore", sourceJobId: input.jobId, parseSessionId: input.parseSessionId, createdByHqUserId: input.hqUserId });
    const incomingKeys = new Set(active.map((row) => keyFor({ memberId: row.memberId!, recordedDate: input.recordedDate, period: input.period })));
    for (const row of old) if (!incomingKeys.has(keyFor(row))) setHead(context, { ...row, score: null });
    for (const row of active) setHead(context, { memberId: row.memberId!, memberName: names.get(row.memberId!)!, recordedDate: input.recordedDate, period: input.period, score: row.scoreValue, origin: "hq", batchId, sourceJobId: input.jobId, basis: [] });
    await persistMutation(context);
    const originals = new Map(parsed.map((row) => [row.id, row]));
    let rowsEdited = 0;
    for (const row of input.rows) {
      const original = originals.get(row.id)!;
      const edited = !row.deleted && original.manuallyAdded !== 1 && (original.memberId !== row.memberId || original.score !== String(row.score) || original.rank !== (row.rank ?? null));
      if (edited) rowsEdited++;
      await tx.update(schema.parsedRows).set({
        memberId: row.memberId ?? null, memberName: row.memberId ? names.get(row.memberId) ?? null : null,
        score: row.deleted ? String(row.score ?? "") : String(parseVsScore(row.score)), rank: row.rank ?? null,
        deleted: row.deleted ? 1 : 0, edited: edited ? 1 : 0, updatedAt: now,
      }).where(and(eq(schema.parsedRows.id, row.id), eq(schema.parsedRows.parseSessionId, input.parseSessionId)));
    }
    const metrics = { rowsSaved: active.length, rowsEdited, rowsDeleted: input.rows.filter((row) => row.deleted).length, rowsAdded: active.filter((row) => originals.get(row.id)?.manuallyAdded === 1).length };
    const quality = computeQualityScore({ ...metrics, status: "complete" });
    await tx.update(schema.videoJobs).set({ status: "complete", recordedDate: input.recordedDate, updatedAt: now, ...buildReviewOutcomePatch({ reviewOpenedAt: job.reviewOpenedAt, endedAt: now, ...metrics, qualityScore: quality.qualityScore, qualityBucket: quality.qualityBucket }) }).where(eq(schema.videoJobs.id, input.jobId));
    await tx.update(schema.parseSessions).set({ status: "submitted", updatedAt: now }).where(eq(schema.parseSessions.id, input.parseSessionId));
    await tx.insert(schema.auditLog).values({ id: nanoid(), allianceId: input.allianceId, hqUserId: input.hqUserId, action: "vs.evidence.submit", resourceType: "video_job", resourceId: input.jobId, metadata: { batchId, revision: revision + 1, recordedDate: input.recordedDate, period: input.period, count: active.length } });
    await tx.insert(schema.vsScoreSubmissions).values({ id: nanoid(), allianceId: input.allianceId, sourceJobId: input.jobId, requestId: input.requestId, digest, batchId, revision: revision + 1, rowCount: active.length });
    return { submitted: active.length, batchId, vsRevision: revision + 1, syncStatus: context.mirror ? "pending" : "local" };
  });
}

export async function listVsHeads(allianceId: string, input: { recordedDate?: string; dates?: string[]; period?: VsPeriod; batchId?: string; rawOnly?: boolean } = {}) {
  return getDb().select().from(schema.vsScoreHeads).where(and(eq(schema.vsScoreHeads.allianceId, allianceId),
    input.recordedDate ? eq(schema.vsScoreHeads.recordedDate, input.recordedDate) : undefined,
    input.dates ? inArray(schema.vsScoreHeads.recordedDate, input.dates) : undefined,
    input.period ? eq(schema.vsScoreHeads.period, input.period) : undefined,
    input.batchId ? eq(schema.vsScoreHeads.batchId, input.batchId) : undefined,
    input.rawOnly ? eq(schema.vsScoreHeads.origin, "hq") : undefined,
  )).orderBy(asc(schema.vsScoreHeads.recordedDate), asc(schema.vsScoreHeads.memberId));
}

export async function changeVsBatches(input: {
  allianceId: string; hqUserId: string; batchIds: string[]; expectedVersions: Record<string, number>;
  canManageAny: boolean; newRecordedDate?: string; wholeDate?: string;
}) {
  if (!input.hqUserId || !input.batchIds.length) throw new VsEvidenceError("forbidden", 403);
  return getDb().transaction(async (tx) => {
    await lockAlliance(tx, input.allianceId);
    const batches = await tx.select().from(schema.dataUploadBatches).where(and(eq(schema.dataUploadBatches.allianceId, input.allianceId), inArray(schema.dataUploadBatches.id, input.batchIds))).for("update");
    if (batches.length !== input.batchIds.length) throw new VsEvidenceError("stale", 409);
    if (input.wholeDate) {
      const current = await tx.select({ id: schema.dataUploadBatches.id }).from(schema.dataUploadBatches).where(and(eq(schema.dataUploadBatches.allianceId, input.allianceId), eq(schema.dataUploadBatches.recordedDate, input.wholeDate), eq(schema.dataUploadBatches.scoreTarget, "vs-performance"), eq(schema.dataUploadBatches.status, "active")));
      if (current.length !== input.batchIds.length || current.some((batch) => !input.batchIds.includes(batch.id))) throw new VsEvidenceError("stale", 409);
    }
    for (const batch of batches) {
      if (batch.status !== "active" || batch.scoreTarget !== "vs-performance" || batch.contextJson.storage !== "hq" || input.expectedVersions[batch.id] !== batch.contextJson.vsRevision) throw new VsEvidenceError("stale", 409);
      if (!input.canManageAny && batch.createdByHqUserId !== input.hqUserId) throw new VsEvidenceError("forbidden", 403);
      if (input.newRecordedDate && !validateVsPeriod(input.newRecordedDate, String(batch.contextJson.vsPeriod))) throw new VsEvidenceError("invalid_period");
    }
    const context = await mutationContext(tx, input.allianceId, input.hqUserId, [...batches.map((batch) => batch.recordedDate), ...(input.newRecordedDate ? [input.newRecordedDate] : [])]);
    const now = new Date();
    for (const batch of batches) {
      const owned = [...context.heads.values()].filter((row) => row.batchId === batch.id && row.origin === "hq" && row.score != null);
      const nextBatchId = input.newRecordedDate ? nanoid(16) : null;
      if (input.newRecordedDate) {
        await tx.insert(schema.dataUploadBatches).values({
          id: nextBatchId!, allianceId: input.allianceId, scoreTarget: batch.scoreTarget, submitEntity: batch.submitEntity,
          recordedDate: input.newRecordedDate, contextJson: { ...batch.contextJson, vsRevision: Number(batch.contextJson.vsRevision) + 1, vsRequestId: null, vsDigest: null },
          rowCount: owned.length, sourceJobId: batch.sourceJobId, parseSessionId: batch.parseSessionId, createdByHqUserId: batch.createdByHqUserId, submittedAt: now,
        });
      }
      for (const row of owned) {
        setHead(context, { ...row, score: null });
        if (input.newRecordedDate) {
          const target = { ...row, recordedDate: input.newRecordedDate, batchId: nextBatchId };
          const existing = context.heads.get(keyFor(target));
          if (existing?.score != null && existing.origin === "hq" && existing.batchId !== batch.id) throw new VsEvidenceError("stale", 409);
          setHead(context, target);
        }
      }
      await tx.update(schema.dataUploadBatches).set({
        status: input.newRecordedDate ? "moved" : "deleted", movedToDate: input.newRecordedDate ?? null,
        deletedAt: input.newRecordedDate ? null : now, updatedAt: now,
        ...(!input.newRecordedDate ? { contextJson: { ...batch.contextJson, vsRevision: Number(batch.contextJson.vsRevision) + 1, vsRequestId: null, vsDigest: null } } : {}),
      }).where(eq(schema.dataUploadBatches.id, batch.id));
      if (input.newRecordedDate && batch.sourceJobId) await tx.update(schema.videoJobs).set({ recordedDate: input.newRecordedDate, updatedAt: now }).where(eq(schema.videoJobs.id, batch.sourceJobId));
      await tx.insert(schema.auditLog).values({ id: nanoid(), allianceId: input.allianceId, hqUserId: input.hqUserId, action: input.newRecordedDate ? "vs.evidence.move" : "vs.evidence.delete", resourceType: "data_upload_batch", resourceId: batch.id, metadata: { fromDate: batch.recordedDate, toDate: input.newRecordedDate ?? null, nextBatchId } });
    }
    await persistMutation(context);
    return { changed: batches.length, syncStatus: context.mirror ? "pending" : "local" };
  });
}
