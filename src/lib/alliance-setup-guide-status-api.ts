import "server-only";

import { and, eq } from "drizzle-orm";

import {
  allianceSetupGuideProgress,
  computeAllianceSetupGuideTasks,
  type AllianceSetupGuideTaskStatus,
} from "@/lib/alliance-setup-guide-status.shared";
import { loadAllianceSetupGuideSignals } from "@/lib/alliance-setup-guide-server";
import { getDb, schema } from "@/lib/db";

export type AllianceSetupStatusPayload = {
  tasks: AllianceSetupGuideTaskStatus[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  setupGuideDismissed: boolean;
  setupGuideShowOnDashboard: boolean;
  operatingMode: "native" | "ashed";
  viewerIsOfficer: boolean;
};

export async function buildAllianceSetupStatusPayload(input: {
  allianceId: string;
  hqUserId: string;
  sessionId: string;
}): Promise<AllianceSetupStatusPayload | null> {
  const signals = await loadAllianceSetupGuideSignals(input);
  const tasks = computeAllianceSetupGuideTasks(signals);
  const progress = allianceSetupGuideProgress(tasks);

  return {
    tasks,
    ...progress,
    setupGuideDismissed: signals.setupGuideDismissed,
    setupGuideShowOnDashboard: signals.setupGuideShowOnDashboard,
    operatingMode: signals.operatingMode,
    viewerIsOfficer: signals.viewerIsOfficer,
  };
}

export async function updateAllianceSetupGuidePrefs(input: {
  allianceId: string;
  hqUserId: string;
  setupGuideDismissed?: boolean;
  setupGuideShowOnDashboard?: boolean;
}): Promise<void> {
  const db = getDb();
  const patch: Partial<typeof schema.allianceMemberships.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.setupGuideDismissed !== undefined) {
    patch.setupGuideDismissed = input.setupGuideDismissed ? 1 : 0;
  }
  if (input.setupGuideShowOnDashboard !== undefined) {
    patch.setupGuideShowOnDashboard = input.setupGuideShowOnDashboard ? 1 : 0;
  }

  await db
    .update(schema.allianceMemberships)
    .set(patch)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, input.allianceId),
        eq(schema.allianceMemberships.hqUserId, input.hqUserId),
      ),
    );
}
