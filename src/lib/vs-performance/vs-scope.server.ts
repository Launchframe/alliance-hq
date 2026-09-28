import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { schema } from "@/lib/db";
import type { AvailabilityTransaction } from "@/lib/time-off/availability.server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { loadSession } from "@/lib/session";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import type { VsActor } from "@/lib/vs-performance/weekly-view.shared";
import { ashedOpponentSnapshotKey, type AshedOpponentSnapshot, type VsOpponentField } from "@/lib/vs-performance/opponent-info.shared";

export function vsOpponentConflictToken(input: {
  remote: AshedOpponentSnapshot;
  matchupVersion: number;
  days: readonly (readonly [string, number])[];
  fields: readonly VsOpponentField[];
  scope: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    ashedOpponentSnapshotKey(input.remote),
    input.matchupVersion,
    [...input.days].sort((a, b) => a[0].localeCompare(b[0])),
    [...new Set(input.fields)].sort(),
    input.scope,
  ])).digest("hex");
}

export function vsScope(actor: VsActor, weekStart: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actor.sessionId,
        actor.hqUserId,
        actor.allianceId,
        weekStart,
      ]),
    )
    .digest("hex");
}

export function vsContextScope(actor: VsActor): string {
  return createHash('sha256').update(JSON.stringify([
    actor.sessionId, actor.hqUserId, actor.allianceId,
  ])).digest('hex');
}

export async function assertVsActorCurrent(
  actor: VsActor,
  permission: string | null = "trains:write",
): Promise<void> {
  const session = await loadSession(actor.sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId;
  if (
    !session ||
    session.hqUserId !== actor.hqUserId ||
    allianceId !== actor.allianceId ||
    !actor.hqUserId
  ) {
    throw new VsPerformanceError("forbidden", 403);
  }
  if (
    !(await sessionHasPermissionForAlliance(
      actor.sessionId,
      actor.allianceId,
      permission,
    ))
  ) {
    throw new VsPerformanceError("forbidden", 403);
  }
}

export async function assertVsActorContextTx(tx: AvailabilityTransaction, actor: VsActor): Promise<void> {
  const [session] = await tx.select({
    hqUserId: schema.sessions.hqUserId,
    currentAllianceId: schema.sessions.currentAllianceId,
    allianceId: schema.sessions.allianceId,
    expiresAt: schema.sessions.expiresAt,
  }).from(schema.sessions).where(eq(schema.sessions.id, actor.sessionId)).limit(1);
  if (!actor.hqUserId || !session || session.expiresAt <= new Date() || session.hqUserId !== actor.hqUserId || (session.currentAllianceId ?? session.allianceId) !== actor.allianceId) throw new VsPerformanceError("forbidden", 403);
}

export async function assertVsAshedLinkTx(tx: AvailabilityTransaction, allianceId: string, externalId: string): Promise<void> {
  const [alliance] = await tx.select({ externalId: schema.alliances.ashedAllianceId, mode: schema.alliances.operatingMode }).from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
  if (!alliance || alliance.externalId !== externalId || alliance.mode === "native") throw new VsPerformanceError("stale", 409);
}

export function assertVsScope(
  actor: VsActor,
  weekStart: string,
  scope: unknown,
): void {
  if (typeof scope !== "string" || scope !== vsScope(actor, weekStart)) {
    throw new VsPerformanceError("stale", 409);
  }
}
