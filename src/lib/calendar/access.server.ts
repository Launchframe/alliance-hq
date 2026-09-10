import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { requireApiSession } from "@/lib/session";
import { sessionHasConflictingAshedCredentialForHqUser } from "@/lib/rbac/ashed-session-membership";
import { CalendarError, type CalendarSource } from "./types.shared";

export type CalendarTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type CalendarPrincipal = { hqUserId: string; allianceId: string; tag: string; permissions: Set<string>; memberIds: string[]; aliases: string[] };
export const calendarSourcePermission: Record<CalendarSource, string | null> = { regular: "members:read", battle: "battle_plan:read", boarding: null, plunder: "plunder_plan:read", teams: "support_teams:read", timeOff: "time_off:read" };

export async function requireCalendarUser(request?: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse || !session.hqUserId) throw new CalendarError("forbidden", 403);
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new CalendarError("forbidden", 403);
  }
  return session as typeof session & { hqUserId: string };
}

export async function assertCalendarAllianceConsent(sessionId: string, hqUserId: string, allianceId: string) {
  const memberships = await getDb().select({ source: schema.allianceMemberships.source }).from(schema.allianceMemberships).where(and(eq(schema.allianceMemberships.hqUserId, hqUserId), eq(schema.allianceMemberships.allianceId, allianceId), eq(schema.allianceMemberships.status, "active")));
  if (!memberships.length || (memberships.some((row) => row.source === "ashed") && await sessionHasConflictingAshedCredentialForHqUser(sessionId, hqUserId))) throw new CalendarError("forbidden", 403);
}

export async function calendarPrincipal(tx: Pick<CalendarTx, "select">, hqUserId: string, allianceId: string): Promise<CalendarPrincipal | null> {
  const memberships = await tx.select({ role: schema.allianceMemberships.roleId, tag: schema.alliances.tag }).from(schema.allianceMemberships)
    .innerJoin(schema.alliances, eq(schema.alliances.id, schema.allianceMemberships.allianceId))
    .innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId))
    .where(and(eq(schema.allianceMemberships.hqUserId, hqUserId), eq(schema.allianceMemberships.allianceId, allianceId), eq(schema.allianceMemberships.status, "active")));
  if (!memberships.length) return null;
  const grants = await tx.select({ id: schema.rolePermissions.permissionId }).from(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, memberships.map((row) => row.role)));
  const links = await tx.select().from(schema.discordHqLinks).where(eq(schema.discordHqLinks.hqUserId, hqUserId));
  const legacy = await tx.select({ id: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks).where(and(eq(schema.hqMemberLinks.hqUserId, hqUserId), eq(schema.hqMemberLinks.allianceId, allianceId)));
  const canonical = await tx.select({ id: schema.commanderAllianceMemberships.ashedMemberId }).from(schema.hqUserCommanders)
    .innerJoin(schema.commanderAllianceMemberships, eq(schema.commanderAllianceMemberships.commanderId, schema.hqUserCommanders.commanderId))
    .where(and(eq(schema.hqUserCommanders.hqUserId, hqUserId), eq(schema.commanderAllianceMemberships.allianceId, allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt)));
  const discord = links.length ? await tx.select({ id: schema.discordMemberLinks.ashedMemberId }).from(schema.discordMemberLinks).where(and(eq(schema.discordMemberLinks.allianceId, allianceId), inArray(schema.discordMemberLinks.discordUserId, links.map((row) => row.discordUserId)))) : [];
  const ids = [...new Set([...legacy, ...canonical, ...discord].map((row) => row.id))];
  const roster = ids.length ? await tx.select({ id: schema.allianceMembers.ashedMemberId, status: schema.allianceMembers.status }).from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, allianceId), inArray(schema.allianceMembers.ashedMemberId, ids))) : [];
  return { hqUserId, allianceId, tag: memberships[0].tag ?? "", permissions: new Set(grants.map((row) => row.id)), memberIds: roster.filter((row) => row.status !== "former").map((row) => row.id), aliases: [`hq:${hqUserId}`, ...links.map((row) => `discord:${row.discordUserId}`)] };
}

export function calendarErrorResponse(error: unknown) {
  return NextResponse.json({ code: error instanceof CalendarError ? error.code : "failed" }, { status: error instanceof CalendarError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
