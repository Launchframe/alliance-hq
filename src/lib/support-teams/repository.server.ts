import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emptyBoard } from "./policy.shared";
import { SupportError, type SupportActor, type SupportBoard, type SupportEvent } from "./types.shared";

export type SupportTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export async function loadBoard(db: Pick<SupportTransaction, "select">, allianceId: string): Promise<SupportBoard> {
  const [row] = await db.select().from(schema.supportTeamBoards).where(eq(schema.supportTeamBoards.allianceId, allianceId));
  if (!row) return emptyBoard(allianceId);
  const fields = await db.select().from(schema.supportTeamFields).where(eq(schema.supportTeamFields.allianceId, allianceId));
  return { allianceId, version: row.version, published: row.published, construction: row.construction, fields: Object.fromEntries(fields.map((field) => [field.key, { value: field.value, version: field.version, actionId: field.actionId }])) };
}
export async function loadHistory(db: Pick<SupportTransaction, "select">, allianceId: string, recentLimit?: number): Promise<SupportEvent[]> {
  const query = db.select({ event: schema.supportTeamEvents.event }).from(schema.supportTeamEvents)
    .where(eq(schema.supportTeamEvents.allianceId, allianceId)).orderBy(recentLimit ? desc(schema.supportTeamEvents.boardVersion) : asc(schema.supportTeamEvents.boardVersion));
  const rows = recentLimit ? await query.limit(Math.max(1, Math.min(200, recentLimit))) : await query;
  return rows.map((row) => row.event).sort((a, b) => a.boardVersion - b.boardVersion);
}
export async function lockBoard(db: SupportTransaction, allianceId: string) {
  await db.insert(schema.supportTeamBoards).values({ allianceId }).onConflictDoNothing();
  await db.select({ id: schema.supportTeamBoards.allianceId }).from(schema.supportTeamBoards).where(eq(schema.supportTeamBoards.allianceId, allianceId)).for("update");
}
export async function recheckActor(db: SupportTransaction, actor: SupportActor, sessionId: string) {
  const [session] = await db.select({ user: schema.sessions.hqUserId, alliance: schema.sessions.currentAllianceId, expiresAt: schema.sessions.expiresAt }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).for("share");
  if (!session || session.user !== actor.principalId || session.alliance !== actor.allianceId || session.expiresAt <= new Date()) throw new SupportError("forbidden");
  const [user] = await db.select({ admin: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, actor.principalId)).for("share");
  if (!user) throw new SupportError("forbidden");
  if (user.admin === 1) return;
  const [membership] = await db.select({ roleId: schema.allianceMemberships.roleId }).from(schema.allianceMemberships)
    .where(and(eq(schema.allianceMemberships.hqUserId, actor.principalId), eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.status, "active"))).for("share");
  if (!membership) throw new SupportError("forbidden");
  const [role] = await db.select({ name: schema.roles.name }).from(schema.roles).where(eq(schema.roles.id, membership.roleId)).for("share");
  if (role?.name === "owner") return;
  if (actor.override) throw new SupportError("forbidden");
  const permissions = await db.select({ id: schema.rolePermissions.permissionId }).from(schema.rolePermissions).where(and(eq(schema.rolePermissions.roleId, membership.roleId), eq(schema.rolePermissions.permissionId, "support_teams:write"))).for("share");
  if (!permissions.length || !actor.canWrite) throw new SupportError("forbidden");
}
export async function persistEvent(db: SupportTransaction, board: SupportBoard, event: SupportEvent, requestHash: string) {
  for (const patch of event.patches) {
    await db.insert(schema.supportTeamFields).values({ allianceId: board.allianceId, key: patch.key, value: patch.after, version: patch.afterVersion, actionId: event.id })
      .onConflictDoUpdate({ target: [schema.supportTeamFields.allianceId, schema.supportTeamFields.key], set: { value: patch.after, version: patch.afterVersion, actionId: event.id } });
  }
  await db.update(schema.supportTeamBoards).set({ version: board.version, published: board.published, construction: board.construction }).where(eq(schema.supportTeamBoards.allianceId, board.allianceId));
  await db.insert(schema.supportTeamEvents).values({ id: event.id, allianceId: board.allianceId, principalId: event.principalId, idempotencyKey: event.idempotencyKey, requestHash, boardVersion: board.version, event });
  if (event.reverses.length) await db.insert(schema.supportTeamReversals).values(event.reverses.map((actionId) => ({ allianceId: board.allianceId, actionId, reversalId: event.id })));
  await db.execute(sql`select pg_notify('support_team_changes', ${JSON.stringify({ allianceId: board.allianceId, version: board.version })})`);
}
