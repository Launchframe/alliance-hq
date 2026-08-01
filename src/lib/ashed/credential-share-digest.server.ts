import "server-only";

import { eq } from "drizzle-orm";

import { countShareActivityForOwnerOnDate } from "@/lib/ashed/credential-share-audit.server";
import { sendCredentialShareOwnerDigestEmail } from "@/lib/ashed/credential-share-email.server";
import { getDb, schema } from "@/lib/db";

export async function runCredentialShareOwnerDigestPass(): Promise<{
  ownersNotified: number;
}> {
  const db = getDb();
  const now = new Date();
  const dayEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);
  const dayLabel = dayStart.toISOString().slice(0, 10);

  const activeShares = await db
    .select({
      ownerHqUserId: schema.ashedCredentialShares.ownerHqUserId,
      allianceId: schema.ashedCredentialShares.allianceId,
    })
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.status, "active"));

  const ownerAlliancePairs = new Map<string, string>();
  for (const row of activeShares) {
    ownerAlliancePairs.set(
      `${row.ownerHqUserId}:${row.allianceId}`,
      row.allianceId,
    );
  }

  let ownersNotified = 0;
  for (const [key, allianceId] of ownerAlliancePairs) {
    const ownerHqUserId = key.split(":")[0]!;
    const activityCount = await countShareActivityForOwnerOnDate(
      ownerHqUserId,
      dayStart,
      dayEnd,
    );
    if (activityCount <= 0) continue;

    await sendCredentialShareOwnerDigestEmail({
      ownerHqUserId,
      allianceId,
      activityCount,
      dayLabel,
    });
    ownersNotified += 1;
  }

  return { ownersNotified };
}
