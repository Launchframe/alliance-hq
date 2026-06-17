import { and, asc, desc, eq, isNull, or } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";

/**
 * Given a new upload's scoreTarget + boardKey, find the active campaign
 * matching that scope and probabilistically assign the group to an arm.
 * Returns { campaignId, armId } if assigned, null if no active campaign
 * or the random roll misses trafficPercent.
 */
export async function assignExperiment(params: {
  scoreTarget: string | null;
  boardKey: string | null;
}): Promise<{ campaignId: string; armId: string } | null> {
  if (!params.scoreTarget) {
    return null;
  }

  const db = getDb();

  // Find most-specific active campaign: boardKey match beats null boardKey;
  // among ties, oldest active campaign wins.
  const campaigns = await db
    .select()
    .from(schema.experimentCampaigns)
    .where(
      and(
        eq(schema.experimentCampaigns.status, "active"),
        eq(schema.experimentCampaigns.scoreTarget, params.scoreTarget),
        or(
          params.boardKey
            ? eq(schema.experimentCampaigns.boardKey, params.boardKey)
            : isNull(schema.experimentCampaigns.boardKey),
          isNull(schema.experimentCampaigns.boardKey),
        ),
      ),
    )
    .orderBy(
      desc(schema.experimentCampaigns.boardKey),
      asc(schema.experimentCampaigns.createdAt),
    );

  if (campaigns.length === 0) {
    return null;
  }

  const campaign = campaigns[0];

  // Traffic percent gate
  if (Math.random() * 100 >= campaign.trafficPercent) {
    return null;
  }

  const arms = await db
    .select()
    .from(schema.experimentArms)
    .where(eq(schema.experimentArms.campaignId, campaign.id));

  if (arms.length === 0) {
    return null;
  }

  const totalWeight = arms.reduce((sum, arm) => sum + arm.trafficWeight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  let roll = Math.random() * totalWeight;
  let chosenArm = arms[arms.length - 1];
  for (const arm of arms) {
    roll -= arm.trafficWeight;
    if (roll <= 0) {
      chosenArm = arm;
      break;
    }
  }

  return { campaignId: campaign.id, armId: chosenArm.id };
}

/**
 * Look up the most-specific configAssignment for a (scoreTarget, boardKey)
 * combination: scoreTarget+boardKey first, then scoreTarget+null, then
 * global (both null). Returns { passKey, configJson } if found, null otherwise.
 */
export async function lookupConfigAssignment(params: {
  scoreTarget: string | null;
  boardKey: string | null;
}): Promise<{ passKey: string; configJson: ExtractionConfig } | null> {
  const db = getDb();

  const assignments = await db
    .select({
      scoreTarget: schema.configAssignments.scoreTarget,
      boardKey: schema.configAssignments.boardKey,
      configId: schema.configAssignments.configId,
    })
    .from(schema.configAssignments);

  // Most-specific first: exact match, then scoreTarget+null, then global
  const exactMatch = assignments.find(
    (a) => a.scoreTarget === params.scoreTarget && a.boardKey === params.boardKey,
  );
  const scoreOnlyMatch = assignments.find(
    (a) => a.scoreTarget === params.scoreTarget && a.boardKey === null,
  );
  const globalMatch = assignments.find(
    (a) => a.scoreTarget === null && a.boardKey === null,
  );

  const match = exactMatch ?? scoreOnlyMatch ?? globalMatch;
  if (!match) {
    return null;
  }

  const [config] = await db
    .select({
      passKey: schema.parseConfigs.passKey,
      configJson: schema.parseConfigs.configJson,
    })
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, match.configId))
    .limit(1);

  if (!config) {
    return null;
  }

  return {
    passKey: config.passKey,
    configJson: config.configJson as ExtractionConfig,
  };
}
