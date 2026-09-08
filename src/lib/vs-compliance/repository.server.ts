import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { canAccessVsCompliance, type VsCompliancePermission } from "./access.shared";
import type { VsComplianceActor } from "./access.server";
import { assembleComplianceWeek, loadComplianceFacts, type ComplianceTx, type ExternalComplianceEvidence } from "./evidence.server";
import { rebuildVsCompliance } from "./evaluate.shared";
import { VsComplianceError } from "./types.shared";

export const complianceHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type ComplianceRow = typeof schema.vsComplianceEvaluations.$inferSelect;

export async function authorizeComplianceTx(tx: ComplianceTx, actor: VsComplianceActor, permission: VsCompliancePermission) {
  const [session] = await tx.select().from(schema.sessions).where(eq(schema.sessions.id, actor.sessionId)).limit(1).for("share");
  if (!session || session.hqUserId !== actor.boundHqUserId || session.expiresAt <= new Date()) throw new VsComplianceError("forbidden", 403);
  const users = await tx.select({ id: schema.hqUsers.id, maintainer: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(inArray(schema.hqUsers.id, [...new Set([actor.hqUserId, actor.boundHqUserId])])).for("share");
  if (!users.some((user) => user.id === actor.hqUserId)) throw new VsComplianceError("forbidden", 403);
  if (users.some((user) => user.maintainer === 1)) return;
  const permissions = await tx.select({ roleName: schema.roles.name, permissionId: schema.rolePermissions.permissionId }).from(schema.allianceMemberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.allianceMemberships.roleId))
    .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.hqUserId, actor.hqUserId), eq(schema.allianceMemberships.status, "active"))).for("share");
  if (!canAccessVsCompliance({ hqUserId: actor.hqUserId, isPlatformMaintainer: false, roleName: permissions[0]?.roleName ?? null, permissions: new Set(permissions.map((row) => row.permissionId)) }, permission)) throw new VsComplianceError("forbidden", 403);
}

export async function rebuildComplianceTx(tx: ComplianceTx, allianceId: string, requestedWeeks: string[], external: ExternalComplianceEvidence) {
  const facts = await loadComplianceFacts(tx, allianceId);
  if (!facts.alliance) throw new VsComplianceError("not_found", 404);
  const oldRows = await tx.select().from(schema.vsComplianceEvaluations).where(eq(schema.vsComplianceEvaluations.allianceId, allianceId));
  const actions = await tx.select().from(schema.vsComplianceActions).where(eq(schema.vsComplianceActions.allianceId, allianceId));
  const jobs = await tx.select().from(schema.vsComplianceSyncJobs).where(eq(schema.vsComplianceSyncJobs.allianceId, allianceId));
  const weeks = [...new Set([...requestedWeeks, ...oldRows.map((row) => row.weekEnding)])].sort();
  const rows: ComplianceRow[] = [];
  const changedRows: ComplianceRow[] = [];
  const reviews: Array<typeof schema.vsComplianceReviews.$inferInsert> = [];
  const expungeIds: string[] = [];
  const inbox: Array<typeof schema.inboxReminderItems.$inferInsert> = [];
  const members = facts.members;
  await tx.update(schema.inboxReminderItems).set({ active: 0 }).where(and(eq(schema.inboxReminderItems.allianceId, allianceId), eq(schema.inboxReminderItems.kind, "vs_compliance")));
  for (const roster of members) {
    const previous = oldRows.filter((row) => row.memberId === roster.memberId);
    const memberActions = actions.filter((action) => action.memberId === roster.memberId);
    const coveredThrough = previous.filter((row) => memberActions.some((action) => action.eventId === row.id && action.kind !== "waive")).map((row) => row.weekEnding).sort().at(-1);
    const inputs = weeks.map((weekEnding) => {
      const old = previous.find((row) => row.weekEnding === weekEnding);
      const id = old?.id ?? complianceHash([allianceId, roster.memberId, weekEnding]);
      const input = assembleComplianceWeek(facts, roster.memberId, weekEnding, external, old?.remoteEvidence, old?.remoteVerifiedAt);
      if (coveredThrough && weekEnding <= coveredThrough && old) input.eligibilitySnapshot = old.input.eligibilitySnapshot ?? old.memberSnapshot;
      const settled = memberActions.find((action) => action.eventId === id && action.kind !== "waive");
      input.waived = memberActions.some((action) => action.eventId === id && action.kind === "waive");
      if (settled && settled.kind !== "waive") input.settled = { actionId: settled.id, evaluationBasis: settled.evaluationBasis, kind: settled.kind, targetRank: settled.targetRank, memberSnapshot: settled.memberSnapshot };
      return input;
    });
    const evaluations = rebuildVsCompliance({ weeks: inputs, policies: facts.policies, member: roster.member, now: new Date(), digest: complianceHash });
    const actionable = evaluations.filter((row) => (!coveredThrough || row.weekEnding > coveredThrough) && row.recommendation.kind !== "none").at(-1)?.weekEnding;
    for (let index = 0; index < evaluations.length; index++) {
      const evaluation = evaluations[index];
      const input = inputs[index];
      const old = previous.find((row) => row.weekEnding === evaluation.weekEnding);
      if (evaluation.weekEnding !== actionable) evaluation.recommendation = { kind: "none", targetRank: null };
      evaluation.confirmationBasis = complianceHash([evaluation.confirmationBasis, evaluation.recommendation, coveredThrough ?? null]);
      const fetched = external.weeks.get(evaluation.weekEnding);
      const row: ComplianceRow = {
        id: old?.id ?? complianceHash([allianceId, roster.memberId, evaluation.weekEnding]), allianceId, memberId: roster.memberId, memberName: roster.name,
        weekEnding: evaluation.weekEnding, input, evaluation, memberSnapshot: roster.member,
        remoteEvidence: fetched ? fetched.get(roster.memberId) ?? [] : old?.remoteEvidence ?? [],
        remoteVerifiedAt: fetched ? external.verifiedAt : old?.remoteVerifiedAt ?? null, updatedAt: new Date(),
      };
      if (!old || JSON.stringify({ ...old, updatedAt: null }) !== JSON.stringify({ ...row, updatedAt: null })) changedRows.push(row);
      rows.push(row);
      if (evaluation.correctionReview && evaluation.settled && old?.evaluation.evaluationBasis !== evaluation.evaluationBasis) {
        reviews.push({ id: nanoid(), allianceId, actionId: evaluation.settled.actionId, evaluationBasis: complianceHash(evaluation.evaluationBasis) });
        if (["passed", "excused", "waived"].includes(evaluation.outcome)) expungeIds.push(row.id);
      }
    }
    const ownRows = rows.filter((row) => row.memberId === roster.memberId);
    const work = ownRows.find((row) => row.evaluation.recommendation.kind !== "none") ?? ownRows.find((row) => row.evaluation.correctionReview) ?? ownRows.at(-1);
    const active = ownRows.some((row) => row.evaluation.recommendation.kind !== "none" || row.evaluation.correctionReview) || jobs.some((job) => job.memberId === roster.memberId && !job.supersededAt && !["local", "synced"].includes(job.status));
    const itemId = `vs-compliance:${complianceHash([allianceId, roster.memberId])}`;
    inbox.push({ id: itemId, allianceId, kind: "vs_compliance", title: "VS compliance", body: null, href: `/vs-compliance?weekEnding=${work?.weekEnding ?? requestedWeeks[0]}`, resourceId: work?.id ?? null, requiredPermission: VS_COMPLIANCE_READ_PERMISSION, active: active ? 1 : 0 });
  }
  for (let offset = 0; offset < changedRows.length; offset += 200) await tx.insert(schema.vsComplianceEvaluations).values(changedRows.slice(offset, offset + 200)).onConflictDoUpdate({
    target: [schema.vsComplianceEvaluations.allianceId, schema.vsComplianceEvaluations.memberId, schema.vsComplianceEvaluations.weekEnding],
    set: { memberName: sql`excluded.member_name`, input: sql`excluded.input`, evaluation: sql`excluded.evaluation`, memberSnapshot: sql`excluded.member_snapshot`, remoteEvidence: sql`excluded.remote_evidence`, remoteVerifiedAt: sql`excluded.remote_verified_at`, updatedAt: sql`excluded.updated_at` },
  });
  if (reviews.length) await tx.insert(schema.vsComplianceReviews).values(reviews).onConflictDoNothing();
  if (expungeIds.length) await tx.update(schema.memberViolations).set({ expungedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.memberViolations.allianceId, allianceId), inArray(schema.memberViolations.complianceEventId, expungeIds)));
  if (inbox.length) await tx.insert(schema.inboxReminderItems).values(inbox).onConflictDoUpdate({ target: schema.inboxReminderItems.id, set: { active: sql`excluded.active`, href: sql`excluded.href`, resourceId: sql`excluded.resource_id`, requiredPermission: VS_COMPLIANCE_READ_PERMISSION, body: null } });
  return { rows, actions, jobs, facts };
}

export async function findComplianceReceipt(allianceId: string, actorId: string, requestId: string) {
  const [action] = await getDb().select().from(schema.vsComplianceActions).where(and(eq(schema.vsComplianceActions.allianceId, allianceId), eq(schema.vsComplianceActions.actorId, actorId), eq(schema.vsComplianceActions.requestId, requestId))).limit(1);
  return action ?? null;
}
