import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listCoverageConflictsTx, professionCoverageDuties, trainCoverageDuties } from "@/lib/time-off/coverage.server";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { evaluateVsWeek, vsWeekEndingDate } from "@/lib/vs-scores/evidence.shared";
import { loadWorkContext } from "./work-context.server";
import { fieldKey, memberTeam, readField, teamIds, teamLead } from "./policy.shared";
import { canViewTeamWork, routeTeamWork, type TeamWorkDetail, type WorkRecipient } from "./work-routing.shared";
import { SupportError } from "./types.shared";
import type { SupportTransaction } from "./repository.server";

export const workHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type WorkItem = typeof schema.teamWorkItems.$inferSelect;
export type WorkSession = { sessionId: string; hqUserId: string; allianceId: string };

export async function authorizeWorkSession(tx: SupportTransaction, actor: WorkSession) {
  const [session] = await tx.select({ userId: schema.sessions.hqUserId, allianceId: schema.sessions.currentAllianceId, expiresAt: schema.sessions.expiresAt }).from(schema.sessions).where(eq(schema.sessions.id, actor.sessionId)).for("share");
  if (!session || session.userId !== actor.hqUserId || session.allianceId !== actor.allianceId || session.expiresAt <= new Date()) throw new SupportError("forbidden");
}

export async function reconcileTeamWorkTx(tx: SupportTransaction, allianceId: string, actor?: WorkSession) {
  const context = await loadWorkContext(tx, allianceId);
  let viewer = actor ? context.recipients.find((recipient) => recipient.id === actor.hqUserId) : undefined;
  if (actor) {
    await authorizeWorkSession(tx, actor);
    const [user] = await tx.select({ admin: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, actor.hqUserId)).for("share");
    if (user?.admin === 1) viewer = { id: actor.hqUserId, allianceId, name: null, role: "maintainer", active: true, memberIds: viewer?.memberIds ?? [], permissions: ["members:read", "support_teams:read", "time_off:read", "time_off:write", "trains:write", "alliance:admin", "vs_compliance:read", "vs_compliance:manage"] };
    if (!viewer?.permissions.includes("members:read")) throw new SupportError("forbidden");
  }
  const today = getServerCalendarDate();
  const end = addCalendarDays(today, 90);
  const notices = await tx.select({ id: schema.memberTimeOff.id, memberId: schema.memberTimeOff.ashedMemberId, startDate: schema.memberTimeOff.startDate, endDate: schema.memberTimeOff.endDate, globalAbsence: schema.memberTimeOff.globalAbsence, entryKind: schema.memberTimeOff.entryKind, version: schema.memberTimeOff.version, createdAt: schema.memberTimeOff.createdAt })
    .from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.allianceId, allianceId), isNull(schema.memberTimeOff.cancelledAt), gte(schema.memberTimeOff.endDate, today), lte(schema.memberTimeOff.startDate, end)));
  const tenure = await tx.select({ memberId: schema.memberAllianceTenure.ashedMemberId, joinedAt: schema.memberAllianceTenure.joinedAt }).from(schema.memberAllianceTenure).where(and(eq(schema.memberAllianceTenure.allianceId, allianceId), isNull(schema.memberAllianceTenure.leftAt)));
  const memberships = await tx.select({ memberId: schema.commanderAllianceMemberships.ashedMemberId, joinedAt: schema.commanderAllianceMemberships.joinedAt }).from(schema.commanderAllianceMemberships).where(and(eq(schema.commanderAllianceMemberships.allianceId, allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt)));
  const starts = new Map([...memberships, ...tenure].map((row) => [row.memberId, row.joinedAt]));
  const personalNotices = notices.filter((notice) => context.stints[notice.memberId] && starts.has(notice.memberId) && notice.createdAt >= starts.get(notice.memberId)!);
  const currentNotices = personalNotices.filter((notice) => notice.globalAbsence);
  const awayMemberIds = currentNotices.filter((notice) => notice.startDate <= today && notice.endDate >= today).map((notice) => notice.memberId);
  const evaluations = await tx.select().from(schema.vsComplianceEvaluations).where(eq(schema.vsComplianceEvaluations.allianceId, allianceId));
  const jobs = await tx.select({ memberId: schema.vsComplianceSyncJobs.memberId, actionId: schema.vsComplianceSyncJobs.actionId, status: schema.vsComplianceSyncJobs.status, supersededAt: schema.vsComplianceSyncJobs.supersededAt }).from(schema.vsComplianceSyncJobs).where(eq(schema.vsComplianceSyncJobs.allianceId, allianceId));
  const previous = await tx.select().from(schema.teamWorkItems).where(eq(schema.teamWorkItems.allianceId, allianceId)).for("update");
  const items: WorkItem[] = [];
  const add = (kind: WorkItem["kind"], memberId: string, key: unknown, source: unknown, requiredPermission: string, detail: TeamWorkDetail, href: string) => {
    const member = context.roster.find((row) => row.id === memberId);
    const stint = context.stints[memberId];
    if (!member || !stint) return;
    const teamId = memberTeam(context.board, memberId);
    const assignedLeadId = teamId ? teamLead(context.board, teamId) : null;
    const leadMemberId = context.roster.some((member) => member.id === assignedLeadId && (member.rank === 4 || member.rank === 5)) ? assignedLeadId : null;
    const unavailable = kind === "coverage" ? [...awayMemberIds, ...currentNotices.filter((notice) => notice.startDate <= detail.date && notice.endDate >= detail.date).map((notice) => notice.memberId)] : awayMemberIds;
    const { assigneeId } = routeTeamWork({ allianceId, permission: requiredPermission, leadMemberId, recipients: context.recipients, awayMemberIds: unavailable });
    const sourceKey = workHash([kind, memberId, stint, key]);
    const old = previous.find((item) => item.sourceKey === sourceKey);
    const sourceVersion = workHash([source, { ...detail, memberName: member.name }, href, requiredPermission]);
    const changed = !old || !old.open || old.sourceVersion !== sourceVersion || old.assigneeId !== assigneeId || old.teamId !== teamId;
    items.push({ id: old?.id ?? workHash([allianceId, sourceKey]), allianceId, sourceKey, sourceVersion, kind, memberId, stint, teamId, assigneeId, requiredPermission, detail: { ...detail, memberName: member.name }, href,
      version: old ? old.version + Number(changed) : 1, open: true, createdAt: old?.createdAt ?? new Date(), updatedAt: changed ? new Date() : old.updatedAt });
  };
  for (const notice of currentNotices) add("time_off", notice.memberId, notice.id, notice.version, "time_off:write", { memberName: "", date: notice.startDate, endDate: notice.endDate, unexpected: notice.entryKind === "unexpected" }, "/time-off");
  const conflicts = await listCoverageConflictsTx(tx, allianceId, today, end);
  for (const conflict of conflicts) {
    if (!currentNotices.some((notice) => notice.memberId === conflict.memberId && notice.startDate <= conflict.dutyDate && notice.endDate >= conflict.dutyDate)) continue;
    add("coverage", conflict.memberId, [conflict.assignmentId, conflict.dutyDate, conflict.dutyRole], [conflict.assignmentVersion, conflict.absenceVersion], conflict.dutyRole === "engineer" ? "alliance:admin" : "trains:write", { memberName: "", date: conflict.dutyDate, dutyRole: conflict.dutyRole }, conflict.dutyRole === "engineer" ? "/professions/officer" : `/trains?date=${conflict.dutyDate}`);
  }
  const currentEvaluations = evaluations.filter((row) => context.stints[row.memberId] && starts.has(row.memberId) && row.memberSnapshot.joinedAt && Date.parse(row.memberSnapshot.joinedAt) === starts.get(row.memberId)!.getTime());
  for (const row of currentEvaluations) {
    if (row.evaluation.outcome !== "pending_data" && row.evaluation.recommendation.kind === "none" && !row.evaluation.correctionReview && !jobs.some((job) => job.actionId === row.evaluation.settled?.actionId && !job.supersededAt && !["synced", "local"].includes(job.status))) continue;
    add("vs", row.memberId, row.weekEnding, row.evaluation.confirmationBasis, "vs_compliance:manage", { memberName: "", date: row.weekEnding, outcome: row.evaluation.outcome, evidenceState: row.input.evidence.state, dailyCoverage: row.input.evidence.dailyCoverage, recommendation: row.evaluation.recommendation }, `/vs-compliance?weekEnding=${row.weekEnding}`);
  }
  const closed = previous.filter((item) => item.open && !items.some((next) => next.id === item.id));
  if (closed.length) await tx.update(schema.teamWorkItems).set({ open: false, updatedAt: new Date(), version: sql`${schema.teamWorkItems.version} + 1` }).where(and(eq(schema.teamWorkItems.allianceId, allianceId), inArray(schema.teamWorkItems.id, closed.map((item) => item.id))));
  for (const item of items) {
    if (previous.some((old) => old.id === item.id && old.version === item.version)) continue;
    await tx.insert(schema.teamWorkItems).values(item).onConflictDoUpdate({ target: schema.teamWorkItems.id, set: { sourceVersion: item.sourceVersion, teamId: item.teamId, assigneeId: item.assigneeId, detail: item.detail, href: item.href, version: item.version, open: true, updatedAt: item.updatedAt } });
  }
  await tx.insert(schema.inboxReminderItems).values({ id: `team-work:${workHash(allianceId)}`, allianceId, kind: "team_work", title: "teamWork.digest", href: "/team-work", requiredPermission: null, active: items.length ? 1 : 0 })
    .onConflictDoUpdate({ target: schema.inboxReminderItems.id, set: { active: items.length ? 1 : 0, body: null } });
  for (const recipientId of new Set(items.flatMap((item) => item.assigneeId ? [item.assigneeId] : []))) {
    await tx.insert(schema.teamWorkDigests).values({ id: workHash([allianceId, recipientId, today]), allianceId, recipientId, day: today }).onConflictDoUpdate({ target: schema.teamWorkDigests.id, set: { status: "pending", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(), updatedAt: new Date() }, setWhere: eq(schema.teamWorkDigests.status, "cancelled") });
  }
  const state = { reconciledAt: new Date(), nextAttemptAt: new Date(Date.now() + 60_000), lastError: null };
  await tx.insert(schema.teamWorkState).values({ allianceId, ...state }).onConflictDoUpdate({ target: schema.teamWorkState.allianceId, set: state });
  return { ...context, items, currentNotices, personalNotices, currentEvaluations, viewer, starts };
}

export async function reconcileTeamWork(allianceId: string) {
  return getDb().transaction((tx) => reconcileTeamWorkTx(tx, allianceId));
}

export async function loadTeamWorkDashboard(actor: WorkSession, options: { personal?: boolean; teamId?: string; kind?: string } = {}) {
  return getDb().transaction(async (tx) => {
    const result = await reconcileTeamWorkTx(tx, actor.allianceId, actor);
    const viewer = result.viewer!;
    const ownIds = viewer.memberIds;
    const published = result.board.published || viewer.permissions.includes("support_teams:read");
    const trains = await tx.select().from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.allianceId, actor.allianceId), gte(schema.trainConductorRecords.date, getServerCalendarDate()), lte(schema.trainConductorRecords.date, addCalendarDays(getServerCalendarDate(), 90))));
    const duties = [...trains.flatMap((row) => trainCoverageDuties(row, "")), ...await professionCoverageDuties(tx, actor.allianceId, getServerCalendarDate())];
    const currentWeek = vsWeekEndingDate(getServerCalendarDate());
    const scores = await tx.select({ id: schema.vsScoreHeads.id, memberId: schema.vsScoreHeads.memberId, recordedDate: schema.vsScoreHeads.recordedDate, period: schema.vsScoreHeads.period, score: schema.vsScoreHeads.score, updatedAt: schema.vsScoreHeads.updatedAt }).from(schema.vsScoreHeads)
      .where(and(eq(schema.vsScoreHeads.allianceId, actor.allianceId), eq(schema.vsScoreHeads.origin, "hq"), gte(schema.vsScoreHeads.recordedDate, addCalendarDays(currentWeek, -6)), lte(schema.vsScoreHeads.recordedDate, currentWeek)));
    const teams = teamIds(result.board).filter(() => published).map((id) => ({ id, name: readField(result.board, fieldKey("team", id, "name")) as string | null, leadName: result.roster.find((member) => member.id === teamLead(result.board, id))?.name ?? null }));
    const items = result.items.filter((item) => canViewTeamWork(item, viewer, options.personal !== false) && (!options.teamId || item.teamId === options.teamId) && (!options.kind || item.kind === options.kind)).map((item) => ({ id: item.id, memberId: item.memberId, kind: item.kind, teamId: published ? item.teamId : null, detail: item.detail, href: item.href, assigneeName: result.recipients.find((recipient) => recipient.id === item.assigneeId)?.name ?? null,
      leadName: published ? result.roster.find((member) => member.id === (item.teamId ? teamLead(result.board, item.teamId) : null))?.name ?? null : null,
      leadUnlinked: published && !!item.teamId && !result.recipients.some((recipient) => recipient.memberIds.includes(teamLead(result.board, item.teamId!) ?? "")),
      leadAway: published && !!item.teamId && result.currentNotices.some((notice) => notice.memberId === teamLead(result.board, item.teamId!) && notice.startDate <= getServerCalendarDate() && notice.endDate >= getServerCalendarDate()),
    }));
    const ledTeams = teamIds(result.board).filter((id) => ownIds.includes(teamLead(result.board, id) ?? ""));
    const canReadMembers = ["time_off:read", "trains:write", "vs_compliance:read"].some((permission) => eligibleRead(viewer, permission));
    const visibleMembers = result.roster.filter((member) => ownIds.includes(member.id) || published && canReadMembers && (ledTeams.includes(memberTeam(result.board, member.id) ?? "") || options.personal === false));
    const members = visibleMembers.map((member) => {
      const own = ownIds.includes(member.id);
      const canRead = eligibleRead(viewer, "vs_compliance:read");
      const start = result.starts.get(member.id);
      const records = scores.filter((score) => score.memberId === member.id && start && score.updatedAt >= start && score.recordedDate >= getServerCalendarDate(start))
        .flatMap((score) => score.score !== null && (score.period === "daily" || score.period === "weekly") ? [{ ...score, score: score.score, period: score.period }] : []);
      const currentEvidence = evaluateVsWeek(records, currentWeek);
      const days = Array.from({ length: 6 }, (_, index) => {
        const date = addCalendarDays(currentWeek, index - 6);
        const score = records.find((record) => record.period === "daily" && record.recordedDate === date)?.score ?? (index === 5 ? currentEvidence.derivedSaturday?.score ?? null : null);
        return { date, score: currentEvidence.state === "conflict" ? null : score, evidenceState: currentEvidence.state === "conflict" ? "conflict" as const : score === null ? "missing" as const : "ready" as const };
      });
      return { id: member.id, name: member.name, own, teamId: published ? memberTeam(result.board, member.id) : null,
        duties: own || eligibleRead(viewer, "trains:write") ? duties.filter((duty) => duty.memberId === member.id).map((duty) => ({ date: duty.dutyDate, role: duty.dutyRole })) : [],
        absences: own || eligibleRead(viewer, "time_off:read") ? (own ? result.personalNotices : result.currentNotices).filter((notice) => notice.memberId === member.id).map((notice) => ({ startDate: notice.startDate, endDate: notice.endDate, unexpected: notice.entryKind === "unexpected" })) : [],
        currentWeek: own || canRead ? { weekEnding: currentWeek, evidenceState: currentEvidence.state, dailyCoverage: currentEvidence.dailyCoverage, score: currentEvidence.score, days } : null,
        weeks: own || canRead ? result.currentEvaluations.filter((row) => row.memberId === member.id).sort((a, b) => b.weekEnding.localeCompare(a.weekEnding)).slice(0, 4).map((row) => ({ weekEnding: row.weekEnding, outcome: row.evaluation.outcome, dailyCoverage: row.input.evidence.dailyCoverage, evidenceState: row.input.evidence.state })) : [],
      };
    });
    return { teams, members, items, canReview: viewer.permissions.includes("trains:write") && ["owner", "maintainer", "officer"].includes(viewer.role) };
  });
}

function eligibleRead(viewer: WorkRecipient, permission: string) {
  return ["owner", "maintainer", "officer"].includes(viewer.role) && viewer.permissions.includes(permission);
}
