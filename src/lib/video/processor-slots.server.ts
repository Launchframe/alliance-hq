import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getRbacContext } from "@/lib/rbac/context";
import { VIDEO_READ_PERMISSION } from "@/lib/rbac/constants";

/** Ashed ToS: at most two designated processors per alliance may run OCR. */
export const MAX_VIDEO_PROCESSORS = 2;

/** Roles that may always process video without occupying a processor slot. */
const BYPASS_ROLE_NAMES = new Set(["owner", "maintainer"]);

export type AllianceVideoProcessorEntry = {
  id: string;
  hqUserId: string;
  email: string;
  displayName: string | null;
  grantedByHqUserId: string | null;
  grantedAt: string;
};

export async function listAllianceVideoProcessors(
  allianceId: string,
): Promise<AllianceVideoProcessorEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.allianceVideoProcessors.id,
      hqUserId: schema.allianceVideoProcessors.hqUserId,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      grantedByHqUserId: schema.allianceVideoProcessors.grantedByHqUserId,
      grantedAt: schema.allianceVideoProcessors.grantedAt,
    })
    .from(schema.allianceVideoProcessors)
    .innerJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.allianceVideoProcessors.hqUserId),
    )
    .where(eq(schema.allianceVideoProcessors.allianceId, allianceId))
    .orderBy(schema.allianceVideoProcessors.grantedAt);

  return rows.map((row) => ({
    id: row.id,
    hqUserId: row.hqUserId,
    email: row.email,
    displayName: row.displayName,
    grantedByHqUserId: row.grantedByHqUserId,
    grantedAt: row.grantedAt.toISOString(),
  }));
}

/**
 * Active alliance members eligible to occupy a processor slot. Owner/maintainer
 * are excluded — they can already process without a slot. Officers are the
 * designated pool per the Ashed processing agreement.
 */
export async function listVideoProcessorCandidates(
  allianceId: string,
): Promise<Array<{ hqUserId: string; email: string; displayName: string | null }>> {
  const db = getDb();
  const rows = await db
    .select({
      hqUserId: schema.allianceMemberships.hqUserId,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      roleName: schema.roles.name,
    })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId),
    )
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.allianceMemberships.roleId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
        eq(schema.roles.name, "officer"),
      ),
    );

  return rows.map((row) => ({
    hqUserId: row.hqUserId,
    email: row.email,
    displayName: row.displayName,
  }));
}

export async function countAllianceVideoProcessors(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.allianceVideoProcessors.id })
    .from(schema.allianceVideoProcessors)
    .where(eq(schema.allianceVideoProcessors.allianceId, allianceId));
  return rows.length;
}

export async function isAllianceVideoProcessor(
  allianceId: string,
  hqUserId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.allianceVideoProcessors.id })
    .from(schema.allianceVideoProcessors)
    .where(
      and(
        eq(schema.allianceVideoProcessors.allianceId, allianceId),
        eq(schema.allianceVideoProcessors.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Whether the session may approve/run OCR on its current alliance's jobs.
 * Owner/maintainer and platform maintainers always qualify (no slot needed);
 * other roles must hold an explicit processor slot. This is a permission check
 * only — the caller still verifies a live Ashed credential before dispatching.
 */
export async function sessionCanProcessVideo(
  sessionId: string,
): Promise<boolean> {
  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return false;
  }
  if (ctx.isPlatformMaintainer) {
    return true;
  }
  if (ctx.roleName && BYPASS_ROLE_NAMES.has(ctx.roleName)) {
    return true;
  }
  if (!ctx.currentAllianceId) {
    return false;
  }
  return isAllianceVideoProcessor(ctx.currentAllianceId, ctx.hqUserId);
}

/**
 * Whether the session may view the alliance video queue: anyone with the
 * `hq:video:read` permission (owner/maintainer/platform maintainer) or an
 * explicit processor slot.
 */
export async function sessionCanReadAllianceVideoQueue(
  sessionId: string,
): Promise<boolean> {
  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return false;
  }
  if (ctx.isPlatformMaintainer || ctx.permissions.has(VIDEO_READ_PERMISSION)) {
    return true;
  }
  if (!ctx.currentAllianceId) {
    return false;
  }
  return isAllianceVideoProcessor(ctx.currentAllianceId, ctx.hqUserId);
}

export type GrantVideoProcessorResult =
  | { ok: true; alreadyGranted: boolean }
  | { ok: false; code: "slots_full" };

/** Grant a processor slot, enforcing the per-alliance cap. Idempotent. */
export async function grantVideoProcessor(params: {
  allianceId: string;
  hqUserId: string;
  grantedByHqUserId: string | null;
}): Promise<GrantVideoProcessorResult> {
  const { allianceId, hqUserId, grantedByHqUserId } = params;

  if (await isAllianceVideoProcessor(allianceId, hqUserId)) {
    return { ok: true, alreadyGranted: true };
  }

  const count = await countAllianceVideoProcessors(allianceId);
  if (count >= MAX_VIDEO_PROCESSORS) {
    return { ok: false, code: "slots_full" };
  }

  const db = getDb();
  await db.insert(schema.allianceVideoProcessors).values({
    id: nanoid(16),
    allianceId,
    hqUserId,
    grantedByHqUserId,
  });

  return { ok: true, alreadyGranted: false };
}

export async function revokeVideoProcessor(params: {
  allianceId: string;
  hqUserId: string;
}): Promise<void> {
  const { allianceId, hqUserId } = params;
  const db = getDb();
  await db
    .delete(schema.allianceVideoProcessors)
    .where(
      and(
        eq(schema.allianceVideoProcessors.allianceId, allianceId),
        eq(schema.allianceVideoProcessors.hqUserId, hqUserId),
      ),
    );
}
