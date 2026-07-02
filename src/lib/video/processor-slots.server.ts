import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { resolveSessionAllianceId, listSessionAlliances } from "@/lib/alliance/session-memberships";
import { getDb, schema } from "@/lib/db";
import { formatAllianceRankLabel } from "@/lib/members/alliance-rank";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import {
  getAllianceMembershipRbac,
  getRbacContext,
  sessionHasPermissionForAlliance,
} from "@/lib/rbac/context";
import {
  VIDEO_ENQUEUE_PERMISSION,
  VIDEO_READ_PERMISSION,
} from "@/lib/rbac/constants";
import { loadSession } from "@/lib/session";
import type {
  VideoProcessorCandidate,
  VideoProcessorCandidateList,
} from "@/lib/video/processor-slots.shared";

export type {
  VideoProcessorCandidate,
  VideoProcessorCandidateList,
  VideoProcessorEligibilityMode,
} from "@/lib/video/processor-slots.shared";

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
 * Officers who have linked an Ashed identity before (even if disconnected now).
 * Required today because OCR runs through Ashed; native OCR may relax this later.
 */
async function listAshedConnectedOfficerCandidates(
  allianceId: string,
): Promise<VideoProcessorCandidate[]> {
  const db = getDb();
  const rows = await db
    .select({
      hqUserId: schema.allianceMemberships.hqUserId,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      ashedUserId: schema.hqUsers.ashedUserId,
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

  return rows
    .filter((row) => Boolean(row.ashedUserId?.trim()))
    .map((row) => ({
      hqUserId: row.hqUserId,
      email: row.email,
      displayName: row.displayName,
      subtitle: null,
    }))
    .sort((a, b) =>
      (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email),
    );
}

function formatNativeRankSubtitle(input: {
  allianceRank: number | null;
  allianceRankTitle: string | null;
  memberDisplayName: string | null;
  currentName: string;
}): string | null {
  const rankLabel = formatAllianceRankLabel(input.allianceRank);
  const title = input.allianceRankTitle?.trim() || null;
  if (rankLabel && title) {
    return `${rankLabel} · ${title}`;
  }
  if (rankLabel) {
    return rankLabel;
  }
  return input.memberDisplayName?.trim() || input.currentName;
}

/**
 * Native alliances: linked HQ accounts for in-game R4/R5 roster members.
 * These alliances typically have no officer with Ashed connection history.
 */
async function listNativeR4R5Candidates(
  allianceId: string,
): Promise<VideoProcessorCandidate[]> {
  const db = getDb();
  const rows = await db
    .select({
      hqUserId: schema.hqMemberLinks.hqUserId,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      memberDisplayName: schema.hqMemberLinks.memberDisplayName,
      currentName: schema.allianceMembers.currentName,
      allianceRank: schema.allianceMembers.allianceRank,
      allianceRankTitle: schema.allianceMembers.allianceRankTitle,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.hqMemberLinks.hqUserId),
    )
    .innerJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, schema.hqMemberLinks.allianceId),
        eq(
          schema.allianceMembers.ashedMemberId,
          schema.hqMemberLinks.ashedMemberId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.allianceMembers.status, "active"),
        inArray(schema.allianceMembers.allianceRank, [4, 5]),
      ),
    );

  return rows
    .slice()
    .sort((a, b) => {
      const rankA = a.allianceRank ?? 0;
      const rankB = b.allianceRank ?? 0;
      if (rankB !== rankA) {
        return rankB - rankA;
      }
      const labelA = a.displayName ?? a.memberDisplayName ?? a.email;
      const labelB = b.displayName ?? b.memberDisplayName ?? b.email;
      return labelA.localeCompare(labelB);
    })
    .map((row) => ({
      hqUserId: row.hqUserId,
      email: row.email,
      displayName: row.displayName ?? row.memberDisplayName,
      subtitle: formatNativeRankSubtitle({
        allianceRank: row.allianceRank,
        allianceRankTitle: row.allianceRankTitle,
        memberDisplayName: row.memberDisplayName,
        currentName: row.currentName,
      }),
    }));
}

/**
 * Eligible processor slots depend on alliance operating mode:
 * - Ashed: officers with a prior Ashed identity link (OCR prerequisite today).
 * - Native: HQ users linked to R4/R5 roster members.
 * Owner/maintainer are excluded — they can already process without a slot.
 */
export async function listVideoProcessorCandidates(
  allianceId: string,
): Promise<VideoProcessorCandidateList> {
  const operatingMode = await getAllianceOperatingMode(allianceId);
  if (operatingMode === "native") {
    return {
      candidates: await listNativeR4R5Candidates(allianceId),
      eligibilityMode: "native_r4_r5",
    };
  }
  return {
    candidates: await listAshedConnectedOfficerCandidates(allianceId),
    eligibilityMode: "ashed_connected_officers",
  };
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
  if (!ctx.currentAllianceId) {
    return false;
  }
  return sessionCanProcessVideoForAlliance(sessionId, ctx.currentAllianceId);
}

/**
 * Whether the session may approve/run OCR for jobs in a specific alliance
 * (uses membership in that alliance, not only session.currentAllianceId).
 */
export async function sessionCanProcessVideoForAlliance(
  sessionId: string,
  allianceId: string,
): Promise<boolean> {
  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return false;
  }
  if (ctx.isPlatformMaintainer) {
    return true;
  }
  const { roleName } = await getAllianceMembershipRbac(
    sessionId,
    ctx.hqUserId,
    allianceId,
  );
  if (roleName && BYPASS_ROLE_NAMES.has(roleName)) {
    return true;
  }
  return isAllianceVideoProcessor(allianceId, ctx.hqUserId);
}

/**
 * Cross-device access to a job in a specific alliance: platform maintainer,
 * queue readers, designated processors, or the officer who enqueued the upload.
 */
export async function sessionCanAccessAllianceVideoJob(
  sessionId: string,
  allianceId: string,
  options?: { enqueuedByHqUserId?: string | null },
): Promise<boolean> {
  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return false;
  }
  if (ctx.isPlatformMaintainer) {
    return true;
  }

  if (
    options?.enqueuedByHqUserId &&
    options.enqueuedByHqUserId === ctx.hqUserId &&
    (await sessionHasPermissionForAlliance(
      sessionId,
      allianceId,
      VIDEO_ENQUEUE_PERMISSION,
    ))
  ) {
    return true;
  }

  if (
    await sessionHasPermissionForAlliance(
      sessionId,
      allianceId,
      VIDEO_READ_PERMISSION,
    )
  ) {
    return true;
  }

  return isAllianceVideoProcessor(allianceId, ctx.hqUserId);
}

async function sessionHasVideoEnqueueInAnyAlliance(
  sessionId: string,
): Promise<boolean> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return false;
  }

  const alliances = await listSessionAlliances(session.hqUserId);
  for (const alliance of alliances) {
    if (
      await sessionHasPermissionForAlliance(
        sessionId,
        alliance.id,
        VIDEO_ENQUEUE_PERMISSION,
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Whether the session may view the alliance video queue: platform maintainer,
 * `hq:video:read` or `hq:video:enqueue` in the resolved alliance, a
 * designated processor slot, or (when alliance context is unset) any alliance
 * where the user may enqueue uploads.
 */
export async function sessionCanReadAllianceVideoQueue(
  sessionId: string,
): Promise<boolean> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return false;
  }

  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return false;
  }
  if (ctx.isPlatformMaintainer) {
    return true;
  }

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return sessionHasVideoEnqueueInAnyAlliance(sessionId);
  }

  if (
    await sessionHasPermissionForAlliance(
      sessionId,
      allianceId,
      VIDEO_READ_PERMISSION,
    )
  ) {
    return true;
  }
  if (
    await sessionHasPermissionForAlliance(
      sessionId,
      allianceId,
      VIDEO_ENQUEUE_PERMISSION,
    )
  ) {
    return true;
  }
  return isAllianceVideoProcessor(allianceId, ctx.hqUserId);
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
