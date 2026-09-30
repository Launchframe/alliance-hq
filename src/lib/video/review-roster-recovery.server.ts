import "server-only";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { loadAshedConnectionForAllianceCapability } from "@/lib/ashed/load-ashed-connection.server";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";

import {
  reviewRosterGapCode,
  type ReviewRosterGapCode,
} from "./review-roster-gap.shared";

export type { ReviewRosterGapCode };

/**
 * Classify a local-roster gap before save. This stays on the database and the
 * session credential. Ashed roster sync is not part of the save request.
 */
export async function prepareReviewRosterForSubmit(input: {
  sessionId: string;
  allianceId: string;
  memberIds: readonly string[];
}): Promise<ReviewRosterGapCode | null> {
  const needed = [
    ...new Set(input.memberIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (needed.length === 0) return null;

  const rows = await listActiveAllianceMembersForPool(input.allianceId);
  const ids = new Set(rows.map((row) => row.ashedMemberId));
  const missingCount = needed.filter((id) => !ids.has(id)).length;
  if (missingCount === 0) return null;

  const operatingMode = await getAllianceOperatingMode(input.allianceId);
  if (operatingMode === "native") {
    return reviewRosterGapCode({
      missingCount,
      operatingMode,
      hasAshedSeat: false,
    });
  }

  const ashedAllianceId = await getAshedAllianceIdIfLinked(input.allianceId);
  const connection = ashedAllianceId
    ? await loadAshedConnectionForAllianceCapability({
        sessionId: input.sessionId,
        allianceId: input.allianceId,
        capability: "roster:sync",
        delegatedAction: "video-review-roster-sync",
      })
    : null;

  return reviewRosterGapCode({
    missingCount,
    operatingMode,
    hasAshedSeat: Boolean(ashedAllianceId && connection),
  });
}
