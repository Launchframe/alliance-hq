import "server-only";

import { and, count, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";

export type ClaimConflictReason =
  | "name_collision"
  | "commander_taken"
  | "server_mismatch"
  | "target_mismatch";

export type ClaimConflictStatus = "open" | "resolved" | "dismissed";

export type ClaimConflictRow = typeof schema.hqClaimConflicts.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function openConflictSubjectFilter(input: {
  hqUserId: string | null;
  handle: string;
}) {
  return input.hqUserId
    ? eq(schema.hqClaimConflicts.hqUserId, input.hqUserId)
    : eq(schema.hqClaimConflicts.handle, input.handle);
}

async function findOpenClaimConflict(input: {
  allianceId: string;
  ashedMemberId: string;
  hqUserId: string | null;
  handle: string;
  reason: ClaimConflictReason;
}): Promise<{ id: string } | null> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.hqClaimConflicts.id })
    .from(schema.hqClaimConflicts)
    .where(
      and(
        eq(schema.hqClaimConflicts.allianceId, input.allianceId),
        eq(schema.hqClaimConflicts.ashedMemberId, input.ashedMemberId),
        eq(schema.hqClaimConflicts.reason, input.reason),
        eq(schema.hqClaimConflicts.status, "open"),
        openConflictSubjectFilter(input),
      ),
    )
    .limit(1);
  return existing ?? null;
}

async function updateClaimConflictSnapshot(input: {
  id: string;
  commanderName: string;
  handle: string;
  updatedAt: Date;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.hqClaimConflicts)
    .set({
      commanderName: input.commanderName,
      handle: input.handle,
      updatedAt: input.updatedAt,
    })
    .where(eq(schema.hqClaimConflicts.id, input.id));
}

/**
 * Persist a commander-claim conflict for officer review. Conflicts surfaced by
 * the claim-confirm flow (name collisions, already-claimed races, server
 * mismatches) are stored so alliance officers and platform maintainers can
 * investigate, in addition to the transient pg_notify admin alert.
 *
 * De-duplicates on the open (alliance, member, claimant, reason) tuple so a
 * member retrying the same claim does not stack duplicate review rows.
 */
export async function recordClaimConflict(input: {
  allianceId: string;
  ashedMemberId: string;
  commanderName: string;
  hqUserId: string | null;
  handle: string;
  reason: ClaimConflictReason;
}): Promise<string> {
  const db = getDb();
  const now = new Date();

  const existing = await findOpenClaimConflict({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    hqUserId: input.hqUserId ?? null,
    handle: input.handle,
    reason: input.reason,
  });

  if (existing) {
    await updateClaimConflictSnapshot({
      id: existing.id,
      commanderName: input.commanderName,
      handle: input.handle,
      updatedAt: now,
    });
    return existing.id;
  }

  const id = nanoid();
  try {
    await db.insert(schema.hqClaimConflicts).values({
      id,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      commanderName: input.commanderName,
      hqUserId: input.hqUserId ?? null,
      handle: input.handle,
      reason: input.reason,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const racedExisting = await findOpenClaimConflict({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      hqUserId: input.hqUserId ?? null,
      handle: input.handle,
      reason: input.reason,
    });
    if (!racedExisting) throw error;
    await updateClaimConflictSnapshot({
      id: racedExisting.id,
      commanderName: input.commanderName,
      handle: input.handle,
      updatedAt: now,
    });
    return racedExisting.id;
  }
  return id;
}

export async function listClaimConflicts(input: {
  allianceId: string;
  status?: ClaimConflictStatus;
}): Promise<ClaimConflictRow[]> {
  const db = getDb();
  const filters = [eq(schema.hqClaimConflicts.allianceId, input.allianceId)];
  if (input.status) {
    filters.push(eq(schema.hqClaimConflicts.status, input.status));
  }
  return db
    .select()
    .from(schema.hqClaimConflicts)
    .where(and(...filters))
    .orderBy(desc(schema.hqClaimConflicts.createdAt));
}

export async function countOpenClaimConflicts(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: count() })
    .from(schema.hqClaimConflicts)
    .where(
      and(
        eq(schema.hqClaimConflicts.allianceId, allianceId),
        eq(schema.hqClaimConflicts.status, "open"),
      ),
    );
  return row?.count ?? 0;
}

export async function getClaimConflictById(
  id: string,
): Promise<ClaimConflictRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqClaimConflicts)
    .where(eq(schema.hqClaimConflicts.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Mark a claim conflict resolved or dismissed. Tenant-scoped: the caller's
 * allianceId must match the conflict row.
 */
export async function resolveClaimConflict(input: {
  id: string;
  allianceId: string;
  status: Exclude<ClaimConflictStatus, "open">;
  resolvedByHqUserId: string;
  resolutionNote?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const conflict = await getClaimConflictById(input.id);
  if (!conflict) {
    return { ok: false, reason: "not_found" };
  }
  if (conflict.allianceId !== input.allianceId) {
    return { ok: false, reason: "forbidden" };
  }
  if (conflict.status !== "open") {
    return { ok: false, reason: "not_open" };
  }

  const now = new Date();
  const updated = await db
    .update(schema.hqClaimConflicts)
    .set({
      status: input.status,
      resolutionNote: input.resolutionNote?.trim() || null,
      resolvedAt: now,
      resolvedByHqUserId: input.resolvedByHqUserId,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.hqClaimConflicts.id, input.id),
        eq(schema.hqClaimConflicts.allianceId, input.allianceId),
        eq(schema.hqClaimConflicts.status, "open"),
      ),
    )
    .returning({ id: schema.hqClaimConflicts.id });

  if (updated.length === 0) {
    return { ok: false, reason: "not_open" };
  }

  if (input.sessionId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      hqUserId: input.resolvedByHqUserId,
      allianceId: input.allianceId,
      action: "member_link.claim_conflict_resolved",
      metadata: {
        conflictId: input.id,
        status: input.status,
        ashedMemberId: conflict.ashedMemberId,
        reason: conflict.reason,
      },
    });
  }

  return { ok: true };
}
