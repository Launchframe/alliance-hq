import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { VS_COMPLIANCE_MANAGE_PERMISSION } from "@/lib/rbac/constants";
import { addCalendarDays } from "@/lib/trains/game-time";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { lockCompliance, prepareExternalEvidence, resolveComplianceEvidence, loadComplianceStateVersion, type ExternalComplianceEvidence, type loadComplianceFacts } from "@/lib/vs-compliance/evidence.server";
import { authorizeComplianceTx, computeComplianceRows } from "@/lib/vs-compliance/repository.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { vsDayPhase } from "@/lib/vs-compliance/evaluate.shared";
import { parseVsScore, validateVsPeriod, VsEvidenceError } from "@/lib/vs-scores/evidence.shared";
import { lockAlliance, mutationContext, persistMutation, setHead } from "@/lib/vs-scores/repository.server";
import { assertVsActorContextTx, vsScope } from "./vs-scope.server";
import { parseVsMemberWeekQuery } from "./member-performance.shared";

const changeSchema = z.object({
  recordedDate: z.string(),
  period: z.enum(["daily", "weekly"]),
  expectedHeadVersion: z.number().int().positive().nullable(),
  operation: z.enum(["set", "clear"]),
  score: z.string().optional(),
}).strict();

const commandSchema = z.object({
  weekStart: z.string(),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  inputVersion: z.number().int().nonnegative(),
  changes: z.array(changeSchema).min(1).max(7),
  reason: z.string().max(2000).optional(),
}).strict();

export type VsManualScoreCommand = z.infer<typeof commandSchema>;
export type VsManualCell = {
  recordedDate: string;
  period: "daily" | "weekly";
  score: string | null;
  source: "hq" | "ashed" | "derived" | null;
  expectedHeadVersion: number | null;
  editable: boolean;
  canClear: boolean;
};

type Facts = Awaited<ReturnType<typeof loadComplianceFacts>>;
type Persisted = Pick<typeof schema.vsComplianceEvaluations.$inferSelect, "remoteEvidence" | "remoteVerifiedAt"> | null;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function manualScoreSnapshot(input: {
  allianceId: string;
  memberId: string;
  weekEnding: string;
  inputVersion: number;
  facts: Facts;
  external: ExternalComplianceEvidence;
  persisted: Persisted;
  now: Date;
}): { evidenceFingerprint: string; cells: VsManualCell[] } {
  const { allianceId, memberId, weekEnding, inputVersion, facts, external, persisted, now } = input;
  const dates = Array.from({ length: 6 }, (_, index) => addCalendarDays(weekEnding, index - 6));
  const heads = facts.heads.filter((head) => head.memberId === memberId && (head.recordedDate === weekEnding || dates.includes(head.recordedDate)));
  const remote = external.weeks.get(weekEnding)?.get(memberId) ?? persisted?.remoteEvidence ?? [];
  const resolved = resolveComplianceEvidence(facts, memberId, weekEnding, external, persisted?.remoteEvidence ?? [], persisted?.remoteVerifiedAt ?? null);
  const cells: VsManualCell[] = [...dates.map((date, index) => {
    const head = heads.find((row) => row.period === "daily" && row.recordedDate === date);
    const day = resolved.daily[index];
    const source = head?.origin === "hq" ? "hq" as const : day.source;
    const score = head?.origin === "hq" ? head.score : day.score;
    return {
      recordedDate: date, period: "daily" as const,
      score: score === null || score === undefined ? null : String(score),
      source,
      expectedHeadVersion: head?.version ?? null,
      editable: vsDayPhase(date, now.getTime()) === "closed",
      canClear: score !== null && score !== undefined && source !== "derived",
    };
  }), (() => {
    const head = heads.find((row) => row.period === "weekly" && row.recordedDate === weekEnding);
    const remoteWeekly = remote.filter((row) => row.period === "weekly" && row.recordedDate === weekEnding);
    const unique = new Set(remoteWeekly.map((row) => row.score));
    const score = head?.origin === "hq" ? head.score : unique.size === 1 ? remoteWeekly[0].score : null;
    const source = head?.origin === "hq" ? "hq" as const : score !== null ? "ashed" as const : null;
    return {
      recordedDate: weekEnding, period: "weekly" as const,
      score: score === null || score === undefined ? null : String(score),
      source,
      expectedHeadVersion: head?.version ?? null,
      editable: now.getTime() >= Date.parse(`${weekEnding}T02:00:00.000Z`),
      canClear: score !== null && score !== undefined,
    };
  })()];
  const evidenceFingerprint = digest([
    allianceId, memberId, weekEnding, inputVersion,
    heads.map((row) => [row.period, row.recordedDate, row.version, row.score, row.origin, row.batchId, row.sourceJobId]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    remote.map((row) => [row.id, row.period, row.recordedDate, row.score]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    resolved.daily.map((day) => [day.date, day.score, day.state, day.source, day.sourceReady, day.excused, day.pendingExcusal]),
    [resolved.evidence.state, resolved.evidence.score, resolved.evidence.source, resolved.evidence.dailyCoverage, [...resolved.evidence.basis].sort()],
  ]);
  return { evidenceFingerprint, cells };
}

export async function saveManualVsScores(sessionId: string, allianceId: string, memberId: string, input: unknown) {
  const actor = await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_MANAGE_PERMISSION);
  if (!(await sessionHasPermissionForAlliance(sessionId, allianceId, "scores:write"))) throw new VsComplianceError("forbidden", 403);
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new VsEvidenceError("invalid_rows");
  const command = parsed.data;
  const { weekStart } = parseVsMemberWeekQuery({ weekStart: command.weekStart }, new Date());
  if (weekStart !== command.weekStart || command.scope !== vsScope(actor, weekStart)) throw new VsEvidenceError("stale", 409);
  const weekEnding = addCalendarDays(weekStart, 6);
  const dates = Array.from({ length: 6 }, (_, index) => addCalendarDays(weekEnding, index - 6));
  const seen = new Set<string>();
  const changes = command.changes.map((change) => {
    if (!validateVsPeriod(change.recordedDate, change.period) ||
      (change.period === "weekly" ? change.recordedDate !== weekEnding : !dates.includes(change.recordedDate)) ||
      seen.has(`${change.period}:${change.recordedDate}`) ||
      (change.operation === "clear" && change.score !== undefined) ||
      (change.operation === "set" && change.score === undefined)) throw new VsEvidenceError("invalid_rows");
    seen.add(`${change.period}:${change.recordedDate}`);
    const closed = change.period === "weekly"
      ? Date.now() >= Date.parse(`${weekEnding}T02:00:00.000Z`)
      : vsDayPhase(change.recordedDate, Date.now()) === "closed";
    if (!closed) throw new VsEvidenceError("invalid_period");
    return { ...change, scoreValue: change.operation === "set" ? parseVsScore(change.score) : null };
  }).sort((a, b) => a.recordedDate.localeCompare(b.recordedDate) || a.period.localeCompare(b.period));
  const reason = command.reason?.trim() || null;
  const requestDigest = digest([allianceId, actor.hqUserId, memberId, command.weekStart, command.scope, command.evidenceFingerprint, command.inputVersion, changes.map((change) => [change.recordedDate, change.period, change.expectedHeadVersion, change.operation, change.scoreValue]), reason]);
  const db = getDb();
  const [earlier] = await db.select().from(schema.vsScoreManualEdits).where(and(eq(schema.vsScoreManualEdits.allianceId, allianceId), eq(schema.vsScoreManualEdits.actorId, actor.hqUserId), eq(schema.vsScoreManualEdits.requestId, command.requestId))).limit(1);
  if (earlier) {
    if (earlier.requestDigest !== requestDigest) throw new VsEvidenceError("stale", 409);
    return { ok: true as const, ...earlier.resultJson, replayed: true };
  }
  const [roster] = await db.select({ memberName: schema.allianceMembers.currentName }).from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.ashedMemberId, memberId))).limit(1);
  const [persisted] = await db.select({ memberName: schema.vsComplianceEvaluations.memberName, remoteEvidence: schema.vsComplianceEvaluations.remoteEvidence, remoteVerifiedAt: schema.vsComplianceEvaluations.remoteVerifiedAt }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.memberId, memberId), eq(schema.vsComplianceEvaluations.weekEnding, weekEnding))).limit(1);
  if (!roster && !persisted) throw new VsComplianceError("not_found", 404);
  const external = await prepareExternalEvidence(allianceId, [weekEnding]);
  const [projection, inputVersion] = await Promise.all([
    computeComplianceRows(db, allianceId, [weekEnding], external, { now: new Date() }),
    loadComplianceStateVersion(allianceId),
  ]);
  if (!projection.rows.some((row) => row.memberId === memberId && row.weekEnding === weekEnding) && !persisted) throw new VsComplianceError("not_found", 404);
  const snapshot = manualScoreSnapshot({ allianceId, memberId, weekEnding, inputVersion, facts: projection.facts, external, persisted: persisted ?? null, now: new Date() });
  if (command.inputVersion !== inputVersion || command.evidenceFingerprint !== snapshot.evidenceFingerprint) throw new VsEvidenceError("stale", 409);
  for (const change of changes) {
    const cell = snapshot.cells.find((candidate) => candidate.recordedDate === change.recordedDate && candidate.period === change.period);
    if (!cell || !cell.editable || cell.expectedHeadVersion !== change.expectedHeadVersion || change.operation === "clear" && !cell.canClear) throw new VsEvidenceError("stale", 409);
  }
  const preparedAt = Date.now();
  return db.transaction(async (tx) => {
    await lockAlliance(tx, allianceId);
    const state = await lockCompliance(tx, allianceId);
    await assertVsActorContextTx(tx, actor);
    await authorizeComplianceTx(tx, actor, VS_COMPLIANCE_MANAGE_PERMISSION);
    await authorizeComplianceTx(tx, actor, "scores:write");
    const [replay] = await tx.select().from(schema.vsScoreManualEdits).where(and(eq(schema.vsScoreManualEdits.allianceId, allianceId), eq(schema.vsScoreManualEdits.actorId, actor.hqUserId), eq(schema.vsScoreManualEdits.requestId, command.requestId))).limit(1);
    if (replay) {
      if (replay.requestDigest !== requestDigest) throw new VsEvidenceError("stale", 409);
      return { ok: true as const, ...replay.resultJson, replayed: true };
    }
    if (state.inputVersion !== inputVersion || Date.now() - preparedAt > 30_000) throw new VsEvidenceError("stale", 409);
    const [currentMember] = await tx.select({ memberName: schema.allianceMembers.currentName }).from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.ashedMemberId, memberId))).limit(1);
    const [currentEvaluation] = await tx.select({ memberName: schema.vsComplianceEvaluations.memberName }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.memberId, memberId), eq(schema.vsComplianceEvaluations.weekEnding, weekEnding))).limit(1);
    const memberName = currentMember?.memberName ?? currentEvaluation?.memberName;
    if (!memberName) throw new VsComplianceError("not_found", 404);
    const context = await mutationContext(tx, allianceId, actor.hqUserId, changes.map((change) => change.recordedDate));
    context.manualMemberId = memberId;
    const batchRows: Array<{ id: string; recordedDate: string; period: "daily" | "weekly" }> = [];
    const auditChanges: Array<{ recordedDate: string; period: "daily" | "weekly"; previousScore: number | null; nextScore: number | null; previousVersion: number | null }> = [];
    const now = new Date();
    for (const change of changes) {
      const original = context.original.get(JSON.stringify([memberId, change.period, change.recordedDate]));
      if ((original?.version ?? null) !== change.expectedHeadVersion) throw new VsEvidenceError("stale", 409);
      const batchId = nanoid(16);
      await tx.insert(schema.dataUploadBatches).values({ id: batchId, allianceId, scoreTarget: "vs-performance", submitEntity: "VSScore", recordedDate: change.recordedDate, contextJson: { storage: "hq", vsPeriod: change.period, vsRevision: 1, vsManual: true }, rowCount: 1, sourceJobId: null, parseSessionId: null, createdByHqUserId: actor.hqUserId, submittedAt: now });
      setHead(context, { memberId, memberName, period: change.period, recordedDate: change.recordedDate, score: change.scoreValue, origin: "hq", batchId, sourceJobId: null, basis: [] });
      batchRows.push({ id: batchId, recordedDate: change.recordedDate, period: change.period });
      auditChanges.push({ recordedDate: change.recordedDate, period: change.period, previousScore: original?.score ?? null, nextScore: change.scoreValue, previousVersion: original?.version ?? null });
    }
    await persistMutation(context);
    const resultJson = { changed: changes.length, syncStatus: context.mirror ? "pending" as const : "local" as const };
    const editId = nanoid();
    await tx.insert(schema.vsScoreManualEdits).values({ id: editId, allianceId, actorId: actor.hqUserId, memberId, weekEnding, requestId: command.requestId, requestDigest, reason, resultJson, recordedAt: now });
    await tx.insert(schema.vsScoreManualEditBatches).values(batchRows.map((batch) => ({ batchId: batch.id, editId, recordedDate: batch.recordedDate, period: batch.period })));
    await tx.insert(schema.auditLog).values({ id: nanoid(), sessionId, allianceId, hqUserId: actor.hqUserId, action: "vs.scores.manual_edit", resourceType: "member", resourceId: memberId, severity: "override", metadata: { weekEnding, changes: auditChanges } });
    return { ok: true as const, ...resultJson, replayed: false };
  });
}
