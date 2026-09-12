import "server-only";

import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { requireApiSession } from "@/lib/session";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { sessionHasConflictingAshedCredentialForHqUser } from "@/lib/rbac/ashed-session-membership";
import { PlunderPlanError, type PlanActor } from "./types.shared";

export type PlanTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type PlanIdentity = { principalId: string; aliases: string[]; memberIds: string[]; canSuggest: boolean; canManageSelf: boolean };

export async function requirePlanWebActor(): Promise<PlanActor> {
  const session = await requireApiSession();
  if (session instanceof NextResponse || !session.hqUserId || !session.currentAllianceId) throw new PlunderPlanError("forbidden", 403);
  if (!await sessionHasPermissionForAlliance(session.id, session.currentAllianceId, "plunder_plan:read")) throw new PlunderPlanError("forbidden", 403);
  return { kind: "web", allianceId: session.currentAllianceId, hqUserId: session.hqUserId, sessionId: session.id };
}

export async function resolvePlanIdentity(tx: PlanTx, actor: PlanActor): Promise<PlanIdentity> {
  let hqUserId: string | undefined = actor.kind === "web" ? actor.hqUserId : undefined;
  let discordUserId: string | undefined = actor.kind === "discord" ? actor.discordUserId : undefined;
  const links = await tx.select().from(schema.discordHqLinks).where(actor.kind === "web" ? eq(schema.discordHqLinks.hqUserId, actor.hqUserId) : eq(schema.discordHqLinks.discordUserId, actor.discordUserId)).for("share");
  if (links.length === 1) { hqUserId = links[0].hqUserId; discordUserId = links[0].discordUserId; }
  let canSuggest = false;
  let canManageSelf = actor.kind === "discord";
  if (actor.kind === "web") {
    const [session] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.id, actor.sessionId), eq(schema.sessions.hqUserId, actor.hqUserId), eq(schema.sessions.currentAllianceId, actor.allianceId), gt(schema.sessions.expiresAt, new Date()))).for("share");
    if (!session) throw new PlunderPlanError("forbidden", 403);
    const memberships = await tx.select({ roleId: schema.allianceMemberships.roleId, source: schema.allianceMemberships.source }).from(schema.allianceMemberships).where(and(eq(schema.allianceMemberships.hqUserId, actor.hqUserId), eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.status, "active"))).for("share");
    if (memberships.some((membership) => membership.source === "ashed")) {
      if (await sessionHasConflictingAshedCredentialForHqUser(actor.sessionId, actor.hqUserId)) {
        throw new PlunderPlanError("forbidden", 403);
      }
    }
    const [user] = await tx.select({ admin: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, actor.hqUserId)).for("share");
    const grants = memberships.length ? await tx.select({ permission: schema.rolePermissions.permissionId }).from(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, memberships.map((row) => row.roleId))).for("share") : [];
    if (user?.admin === 1) {
      canSuggest = true;
      canManageSelf = true;
    } else {
      if (!grants.some((row) => row.permission === "plunder_plan:read")) throw new PlunderPlanError("forbidden", 403);
      canSuggest = grants.some((row) => row.permission === "plunder_plan:suggest");
      canManageSelf = grants.some((row) => row.permission === "plunder_plan:self");
    }
  } else {
    const [guild] = await tx.select().from(schema.discordGuildAlliances).where(and(eq(schema.discordGuildAlliances.guildId, actor.guildId), eq(schema.discordGuildAlliances.allianceId, actor.allianceId))).for("share");
    if (!guild) throw new PlunderPlanError("forbidden", 403);
  }
  const memberIds = new Set<string>();
  if (hqUserId) {
    const legacy = await tx.select({ id: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks).where(and(eq(schema.hqMemberLinks.allianceId, actor.allianceId), eq(schema.hqMemberLinks.hqUserId, hqUserId))).for("share");
    const canonical = await tx.select({ id: schema.commanderAllianceMemberships.ashedMemberId }).from(schema.hqUserCommanders)
      .innerJoin(schema.commanderAllianceMemberships, eq(schema.hqUserCommanders.commanderId, schema.commanderAllianceMemberships.commanderId))
      .where(and(eq(schema.hqUserCommanders.hqUserId, hqUserId), eq(schema.commanderAllianceMemberships.allianceId, actor.allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt))).for("share");
    for (const row of [...legacy, ...canonical]) memberIds.add(row.id);
  }
  if (discordUserId) {
    const discord = await tx.select({ id: schema.discordMemberLinks.ashedMemberId }).from(schema.discordMemberLinks).where(and(eq(schema.discordMemberLinks.allianceId, actor.allianceId), eq(schema.discordMemberLinks.discordUserId, discordUserId))).for("share");
    for (const row of discord) memberIds.add(row.id);
  }
  const roster = memberIds.size ? await tx.select({ id: schema.allianceMembers.ashedMemberId, rank: schema.allianceMembers.allianceRank, status: schema.allianceMembers.status }).from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, actor.allianceId), inArray(schema.allianceMembers.ashedMemberId, [...memberIds]))).for("share") : [];
  const active = roster.filter((row) => row.status !== "former");
  if (actor.kind === "discord") {
    if (!active.length) throw new PlunderPlanError("linkRequired", 403);
    canSuggest = active.some((row) => (row.rank ?? 0) >= 4);
  }
  return { principalId: hqUserId ? `hq:${hqUserId}` : `discord:${discordUserId}`, aliases: [...(hqUserId ? [`hq:${hqUserId}`] : []), ...(discordUserId ? [`discord:${discordUserId}`] : [])], memberIds: active.map((row) => row.id), canSuggest, canManageSelf };
}
