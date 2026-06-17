import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import { getAshedConnection } from "@/lib/session";

import { getAllianceOperatingMode } from "./operating-mode";

export async function sessionHasNativeMembership(
  session: Session,
): Promise<boolean> {
  if (!session.hqUserId || !session.currentAllianceId) {
    return false;
  }

  const mode = await getAllianceOperatingMode(session.currentAllianceId);
  if (mode !== "native") {
    return false;
  }

  const db = getDb();
  const [membership] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, session.hqUserId),
        eq(schema.allianceMemberships.allianceId, session.currentAllianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  return Boolean(membership);
}

/** App shell access: native alliance membership OR Ashed credentials. */
export async function sessionHasAppAccess(session: Session): Promise<boolean> {
  if (await sessionHasNativeMembership(session)) {
    return true;
  }

  const connection = await getAshedConnection(session.id);
  return connection !== null;
}
