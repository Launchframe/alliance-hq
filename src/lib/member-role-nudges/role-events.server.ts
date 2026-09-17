import "server-only";

import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type {
  MembershipRoleEventSource,
} from "@/lib/member-role-nudges/types.shared";

export async function appendAllianceMembershipRoleEvent(input: {
  allianceId: string;
  hqUserId: string;
  fromRoleId: string | null;
  toRoleId: string;
  source: MembershipRoleEventSource;
  actorHqUserId?: string | null;
  nudgeId?: string | null;
}): Promise<string> {
  if (input.fromRoleId === input.toRoleId) {
    return "";
  }

  const id = nanoid(16);
  const db = getDb();
  await db.insert(schema.allianceMembershipRoleEvents).values({
    id,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    fromRoleId: input.fromRoleId,
    toRoleId: input.toRoleId,
    source: input.source,
    actorHqUserId: input.actorHqUserId ?? null,
    nudgeId: input.nudgeId ?? null,
  });
  return id;
}
