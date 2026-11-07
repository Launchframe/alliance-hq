import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import { getDb, schema } from "@/lib/db";
import { ROLE_IDS } from "@/lib/rbac/constants";

import {
  decideAllianceMembershipRevoke,
  sessionAllianceAfterRevoke,
  type MembershipRevokeCode,
} from "./revoke-alliance-membership.shared";

export class MembershipRevokeError extends Error {
  readonly code: MembershipRevokeCode;

  constructor(code: MembershipRevokeCode) {
    super(code);
    this.code = code;
  }
}

export async function revokeAllianceMembership(input: {
  membershipId: string;
  actorHqUserId: string;
  actorSessionId: string;
  actorSessionAllianceId: string | null;
  mode: "self" | "admin";
  /** Admin removes must match the user being edited. */
  expectedHqUserId?: string;
}): Promise<{ currentAllianceId: string | null }> {
  const db = getDb();
  const [membership] = await db
    .select({
      id: schema.allianceMemberships.id,
      allianceId: schema.allianceMemberships.allianceId,
      hqUserId: schema.allianceMemberships.hqUserId,
      roleId: schema.allianceMemberships.roleId,
      status: schema.allianceMemberships.status,
    })
    .from(schema.allianceMemberships)
    .where(eq(schema.allianceMemberships.id, input.membershipId))
    .limit(1);

  if (!membership || membership.status !== "active") {
    throw new MembershipRevokeError("not_found");
  }
  if (input.mode === "self" && membership.hqUserId !== input.actorHqUserId) {
    throw new MembershipRevokeError("not_found");
  }
  if (
    input.mode === "admin" &&
    input.expectedHqUserId &&
    membership.hqUserId !== input.expectedHqUserId
  ) {
    throw new MembershipRevokeError("not_found");
  }

  const [ownerCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, membership.allianceId),
        eq(schema.allianceMemberships.status, "active"),
        eq(schema.allianceMemberships.roleId, ROLE_IDS.owner),
      ),
    );

  const others = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      slug: schema.alliances.slug,
      ashedAllianceId: schema.alliances.ashedAllianceId,
    })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.allianceMemberships.allianceId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, membership.hqUserId),
        eq(schema.allianceMemberships.status, "active"),
        ne(schema.allianceMemberships.allianceId, membership.allianceId),
      ),
    )
    .orderBy(asc(schema.alliances.tag), asc(schema.alliances.slug));

  const decision = decideAllianceMembershipRevoke({
    mode: input.mode,
    targetIsOwner: membership.roleId === ROLE_IDS.owner,
    activeOwnerCount: ownerCountRow?.count ?? 0,
    activeMembershipCount: others.length + 1,
    otherAllianceIds: others.map((row) => row.id),
  });
  if (!decision.ok) {
    throw new MembershipRevokeError(decision.code);
  }

  const next = others.find((row) => row.id === decision.nextAllianceId) ?? null;
  const now = new Date();

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.allianceMemberships)
      .set({ status: "revoked", updatedAt: now })
      .where(
        and(
          eq(schema.allianceMemberships.id, membership.id),
          eq(schema.allianceMemberships.status, "active"),
        ),
      )
      .returning({ id: schema.allianceMemberships.id });
    if (!updated) {
      throw new MembershipRevokeError("not_found");
    }

    await tx
      .update(schema.sessions)
      .set({
        currentAllianceId: next?.id ?? null,
        allianceTag: next?.tag?.trim() || null,
        allianceId: next?.ashedAllianceId ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.sessions.hqUserId, membership.hqUserId),
          eq(schema.sessions.currentAllianceId, membership.allianceId),
        ),
      );
  });

  await writeOfficerActionAudit({
    sessionId: input.actorSessionId,
    allianceId: membership.allianceId,
    hqUserId: input.actorHqUserId,
    action: "alliance.membership_revoke",
    severity: "update",
    permission: input.mode === "admin" ? "hq:admin" : "membership:leave",
    resourceType: "alliance_membership",
    resourceId: membership.id,
    metadata: {
      targetHqUserId: membership.hqUserId,
      mode: input.mode,
      nextAllianceId: decision.nextAllianceId,
    },
  });

  const currentAllianceId =
    input.actorHqUserId === membership.hqUserId
      ? sessionAllianceAfterRevoke({
          sessionAllianceId: input.actorSessionAllianceId,
          revokedAllianceId: membership.allianceId,
          nextAllianceId: decision.nextAllianceId,
        })
      : input.actorSessionAllianceId;

  return { currentAllianceId };
}
