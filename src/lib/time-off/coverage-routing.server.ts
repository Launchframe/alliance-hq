import "server-only";

import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { loadWorkContext } from "@/lib/support-teams/work-context.server";
import { memberTeam, teamLead } from "@/lib/support-teams/policy.shared";
import { routeTeamWork } from "@/lib/support-teams/work-routing.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import type { CoverageConflict, CoverageRouting, CoverageRoutingResolver } from "./coverage.shared";

export async function routeCoverageConflicts(allianceId: string, conflicts: CoverageConflict[], resolver?: CoverageRoutingResolver) {
  const overrides = new Map<CoverageConflict, CoverageRouting | null>();
  if (resolver) for (const conflict of conflicts) overrides.set(conflict, await resolver(allianceId, conflict));
  return getDb().transaction(async (tx) => {
    const context = await loadWorkContext(tx, allianceId);
    const today = getServerCalendarDate();
    const tenure = await tx.select({ memberId: schema.memberAllianceTenure.ashedMemberId, joinedAt: schema.memberAllianceTenure.joinedAt }).from(schema.memberAllianceTenure).where(and(eq(schema.memberAllianceTenure.allianceId, allianceId), isNull(schema.memberAllianceTenure.leftAt)));
    const memberships = await tx.select({ memberId: schema.commanderAllianceMemberships.ashedMemberId, joinedAt: schema.commanderAllianceMemberships.joinedAt }).from(schema.commanderAllianceMemberships).where(and(eq(schema.commanderAllianceMemberships.allianceId, allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt)));
    const starts = new Map([...memberships, ...tenure].map((row) => [row.memberId, row.joinedAt]));
    const notices = await tx.select({ memberId: schema.memberTimeOff.ashedMemberId, createdAt: schema.memberTimeOff.createdAt, startDate: schema.memberTimeOff.startDate, endDate: schema.memberTimeOff.endDate }).from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.allianceId, allianceId), eq(schema.memberTimeOff.globalAbsence, true), isNull(schema.memberTimeOff.cancelledAt), gte(schema.memberTimeOff.endDate, today), lte(schema.memberTimeOff.startDate, conflicts.reduce((end, conflict) => conflict.dutyDate > end ? conflict.dutyDate : end, today))));
    const routed: Array<CoverageConflict & { routing: CoverageRouting | null }> = [];
    for (const conflict of conflicts) {
      const away = notices.filter((notice) => context.stints[notice.memberId] && starts.has(notice.memberId) && notice.createdAt >= starts.get(notice.memberId)! && [today, conflict.dutyDate].some((date) => notice.startDate <= date && notice.endDate >= date));
      const teamId = memberTeam(context.board, conflict.memberId);
      const override = overrides.get(conflict);
      const leadMemberId = override ? context.recipients.find((recipient) => recipient.id === override.hqUserId)?.memberIds[0] ?? null : teamId ? teamLead(context.board, teamId) : null;
      const eligibleLeadId = context.roster.some((member) => member.id === leadMemberId && (member.rank === 4 || member.rank === 5)) ? leadMemberId : null;
      const selected = routeTeamWork({ allianceId, permission: conflict.dutyRole === "engineer" ? "alliance:admin" : "trains:write", leadMemberId: eligibleLeadId, recipients: context.recipients, awayMemberIds: away.map((row) => row.memberId) });
      routed.push({ ...conflict, routing: selected.assigneeId ? { hqUserId: selected.assigneeId, name: selected.assigneeName ?? "", kind: selected.routing } : null });
    }
    return routed;
  });
}
