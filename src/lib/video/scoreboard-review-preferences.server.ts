import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_SCOREBOARD_REVIEW_PREFERENCES,
  normalizeScoreboardOfferFlag,
  type ScoreboardReviewPreferences,
} from "@/lib/video/scoreboard-review-preferences.shared";

export {
  canEditScoreboardReviewPreferences,
} from "@/lib/video/scoreboard-review-preferences.shared";

export async function loadScoreboardReviewPreferences(
  hqUserId: string | null | undefined,
): Promise<ScoreboardReviewPreferences> {
  if (!hqUserId) {
    return DEFAULT_SCOREBOARD_REVIEW_PREFERENCES;
  }

  const db = getDb();
  const [user] = await db
    .select({
      offerCreate: schema.hqUsers.offerScoreboardNewMembers,
      offerRename: schema.hqUsers.offerScoreboardMemberNames,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  if (!user) {
    return DEFAULT_SCOREBOARD_REVIEW_PREFERENCES;
  }

  return {
    offerCreate: normalizeScoreboardOfferFlag(user.offerCreate),
    offerRename: normalizeScoreboardOfferFlag(user.offerRename),
  };
}

export async function updateScoreboardReviewPreferences(
  hqUserId: string,
  partial: Partial<ScoreboardReviewPreferences>,
): Promise<ScoreboardReviewPreferences> {
  const db = getDb();
  const patch: {
    updatedAt: Date;
    offerScoreboardNewMembers?: boolean;
    offerScoreboardMemberNames?: boolean;
  } = {
    updatedAt: new Date(),
  };

  if (partial.offerCreate !== undefined) {
    patch.offerScoreboardNewMembers = normalizeScoreboardOfferFlag(
      partial.offerCreate,
    );
  }
  if (partial.offerRename !== undefined) {
    patch.offerScoreboardMemberNames = normalizeScoreboardOfferFlag(
      partial.offerRename,
    );
  }

  await db
    .update(schema.hqUsers)
    .set(patch)
    .where(eq(schema.hqUsers.id, hqUserId));

  return loadScoreboardReviewPreferences(hqUserId);
}
