import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  sessionHasPermissionForAlliance,
} from "@/lib/rbac/context";
import { loadSession } from "@/lib/session";

export class CommanderAccessError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CommanderAccessError";
    this.status = status;
  }
}

export async function resolveCommanderSessionContext(sessionId: string): Promise<{
  allianceId: string;
  hqUserId: string | null;
}> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new CommanderAccessError("Session not found.", 401);
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    throw new CommanderAccessError(
      "No alliance selected. Accept your invite or connect from Settings.",
      400,
    );
  }

  return { allianceId, hqUserId: session.hqUserId };
}

export async function assertCommanderReadAccess(
  sessionId: string,
  allianceId: string,
): Promise<void> {
  const denied = await requireSessionPermission(sessionId, "members:read");
  if (denied) {
    throw new CommanderAccessError("Forbidden.", 403);
  }

  const allowed = await sessionHasPermissionForAlliance(
    sessionId,
    allianceId,
    "members:read",
  );
  if (!allowed) {
    throw new CommanderAccessError("Forbidden.", 403);
  }
}

export async function loadAllianceCommander(
  allianceId: string,
  ashedMemberId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  return row ?? null;
}
