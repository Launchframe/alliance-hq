import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { loadTimeOffAvailability } from "./availability.server";
import { listLinkedCommanderIdsForHqUser } from "./repository.server";
import type { CoverageConflict, CoverageRouting, CoverageRoutingResolver } from "./coverage.shared";

export async function routeCoverageConflicts(allianceId: string, conflicts: CoverageConflict[], teamLead?: CoverageRoutingResolver) {
  const leaders = await getDb().select({ hqUserId: schema.hqUsers.id, name: schema.hqUsers.displayName, role: schema.roles.name })
    .from(schema.allianceMemberships).innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId)).innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(and(eq(schema.allianceMemberships.allianceId, allianceId), eq(schema.allianceMemberships.status, "active"), inArray(schema.roles.name, ["owner", "officer"]))).orderBy(schema.roles.name, schema.hqUsers.id);
  const linked = new Map<string, string[]>();
  for (const leader of leaders) linked.set(leader.hqUserId, await listLinkedCommanderIdsForHqUser({ allianceId, hqUserId: leader.hqUserId }));
  const availability = new Map<string, Set<string>>();
  const routed: Array<CoverageConflict & { routing: CoverageRouting | null }> = [];
  for (const conflict of conflicts) {
    let away = availability.get(conflict.dutyDate);
    if (!away) { away = (await loadTimeOffAvailability(allianceId, conflict.dutyDate)).awayMemberIds; availability.set(conflict.dutyDate, away); }
    const lead = teamLead ? await teamLead(allianceId, conflict) : null;
    const eligible = leaders.filter((leader) => !(linked.get(leader.hqUserId) ?? []).some((id) => away.has(id)));
    const preferred = lead ? eligible.find((leader) => leader.hqUserId === lead.hqUserId) : null;
    const fallback = eligible.find((leader) => !!leader.name);
    const routing: CoverageRouting | null = preferred && lead ? lead : fallback ? { kind: "alliance_leadership", hqUserId: fallback.hqUserId, name: fallback.name! } : null;
    routed.push({ ...conflict, routing });
  }
  return routed;
}
