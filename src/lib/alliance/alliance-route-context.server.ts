import "server-only";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, schema } from "@/lib/db";
import {
  sessionHasPermission,
  sessionHasPermissionForAlliance,
} from "@/lib/rbac/context";
import { loadSession } from "@/lib/session";
import { listHqAlliancesByTag } from "@/lib/vr/resolve-alliance-tag";

export type ResolvedAllianceRoute = {
  allianceId: string;
  tag: string;
  name: string;
};

export class AllianceRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function sessionHasActiveMembership(
  hqUserId: string,
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, hqUserId),
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function listAllianceSettingsTargetsForSession(
  sessionId: string,
): Promise<ResolvedAllianceRoute[]> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({
      allianceId: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
    })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.allianceMemberships.allianceId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, session.hqUserId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    );

  return rows
    .filter((row) => row.tag?.trim())
    .map((row) => ({
      allianceId: row.allianceId,
      tag: row.tag!.trim(),
      name: row.name,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export async function resolveAllianceRouteForSession(
  sessionId: string,
  tagParam: string,
): Promise<ResolvedAllianceRoute> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new AllianceRouteError("Unauthorized.", 401);
  }

  const candidates = await listHqAlliancesByTag(tagParam);
  if (candidates.length === 0) {
    throw new AllianceRouteError("Alliance not found.", 404);
  }

  if (!session.hqUserId) {
    if (candidates.length !== 1) {
      throw new AllianceRouteError("Alliance tag is ambiguous.", 409);
    }
    return {
      allianceId: candidates[0]!.id,
      tag: candidates[0]!.tag,
      name: candidates[0]!.name,
    };
  }

  if (await sessionHasPermission(sessionId, "hq:admin")) {
    const match = candidates[0]!;
    return {
      allianceId: match.id,
      tag: match.tag,
      name: match.name,
    };
  }

  const accessible: ResolvedAllianceRoute[] = [];
  for (const candidate of candidates) {
    if (await sessionHasActiveMembership(session.hqUserId, candidate.id)) {
      accessible.push({
        allianceId: candidate.id,
        tag: candidate.tag,
        name: candidate.name,
      });
    }
  }

  if (accessible.length === 0) {
    throw new AllianceRouteError("Forbidden.", 403);
  }

  if (accessible.length > 1) {
    throw new AllianceRouteError(
      "Multiple alliances share this tag. Contact support to disambiguate.",
      409,
    );
  }

  return accessible[0]!;
}

export function allianceRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof AllianceRouteError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message =
    error instanceof Error ? error.message : "Alliance request failed.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function requireAllianceRoutePermission(
  sessionId: string,
  allianceId: string,
  permission: string,
): Promise<NextResponse | null> {
  const allowed = await sessionHasPermissionForAlliance(
    sessionId,
    allianceId,
    permission,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
