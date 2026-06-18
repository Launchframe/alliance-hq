import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import { readAshedMemberAllianceRank, parseAshedMemberAllianceRank, formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import {
  clearAllianceMemberRank,
  setAllianceMemberRank,
} from "@/lib/members/roster.server";

export type ConfirmMemberRankInput = {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  allianceRank: number;
  allianceRankTitle?: string | null;
  effectiveDate: string;
  source: "manual" | "video_parse" | "ashed_bootstrap";
  recordedByHqUserId?: string | null;
  connection: ParsedConnection;
};

export async function syncMemberRankToAshed(
  connection: ParsedConnection,
  ashedMemberId: string,
  allianceRank: number,
  allianceRankTitle?: string | null,
): Promise<void> {
  await base44Json(connection, `/entities/Member/${ashedMemberId}`, {
    method: "PUT",
    body: JSON.stringify({
      rank: formatAshedMemberRankValue(allianceRank, allianceRankTitle),
    }),
  });
}

export async function clearMemberRankOnAshed(
  connection: ParsedConnection,
  ashedMemberId: string,
  hqAllianceId?: string,
): Promise<void> {
  await base44Json(connection, `/entities/Member/${ashedMemberId}`, {
    method: "PUT",
    body: JSON.stringify({ rank: "" }),
  });

  if (hqAllianceId) {
    await clearAllianceMemberRank({ hqAllianceId, ashedMemberId });
  }
}

export async function confirmMemberRank(
  input: ConfirmMemberRankInput,
): Promise<(typeof schema.memberAllianceRankEvents.$inferSelect)> {
  if (input.allianceRank < 1 || input.allianceRank > 5) {
    throw new Error("Alliance rank must be between 1 and 5.");
  }

  const db = getDb();
  const eventId = nanoid();

  await db.insert(schema.memberAllianceRankEvents).values({
    id: eventId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    allianceRank: input.allianceRank,
    allianceRankTitle: input.allianceRankTitle?.trim() || null,
    effectiveDate: input.effectiveDate,
    source: input.source,
    recordedByHqUserId: input.recordedByHqUserId ?? null,
  });

  try {
    await syncMemberRankToAshed(
      input.connection,
      input.ashedMemberId,
      input.allianceRank,
      input.allianceRankTitle,
    );
    await db
      .update(schema.memberAllianceRankEvents)
      .set({ ashedSyncedAt: new Date() })
      .where(eq(schema.memberAllianceRankEvents.id, eventId));

    await setAllianceMemberRank({
      hqAllianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      allianceRank: input.allianceRank,
      allianceRankTitle: input.allianceRankTitle,
    });
  } catch (error) {
    throw new Error(
      `Rank saved in HQ but Ashed sync failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const [row] = await db
    .select()
    .from(schema.memberAllianceRankEvents)
    .where(eq(schema.memberAllianceRankEvents.id, eventId))
    .limit(1);

  if (!row) {
    throw new Error("Failed to load rank event after insert.");
  }
  return row;
}

export async function bootstrapRanksFromAshedMembers(
  allianceId: string,
  members: Array<Record<string, unknown>>,
  effectiveDate: string,
  connection: ParsedConnection,
  recordedByHqUserId?: string | null,
): Promise<number> {
  let imported = 0;
  for (const member of members) {
    const id = String(member.id ?? "");
    const name = String(member.current_name ?? member.currentName ?? "Unknown");
    const parsed = parseAshedMemberAllianceRank(member);
    if (!id || parsed.rank == null) continue;

    await confirmMemberRank({
      allianceId,
      ashedMemberId: id,
      memberName: name,
      allianceRank: parsed.rank,
      allianceRankTitle: parsed.title,
      effectiveDate,
      source: "ashed_bootstrap",
      recordedByHqUserId,
      connection,
    });
    imported += 1;
  }
  return imported;
}

export { readAshedMemberAllianceRank as readMemberRank };
