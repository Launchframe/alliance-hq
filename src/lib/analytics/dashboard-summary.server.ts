import "server-only";

import { and, eq } from "drizzle-orm";

import { computePercentile } from "@/lib/analytics/percentile.shared";
import {
  loadSquadSummaryFromCommanderIndex,
  loadUnlinkedMembersForOfficers,
} from "@/lib/analytics/alliance-daily-snapshot.server";
import { loadCommanderIndex } from "@/lib/commanders/index.server";
import type { CommanderIndexPayload } from "@/lib/commanders/index.shared";
import {
  computeViewerThpStanding,
  loadLatestSnapshot,
  loadMemberThpTable,
  loadSnapshotSeries,
  loadThpValuesForDate,
  parseDashboardRange,
  type SnapshotRow,
} from "@/lib/analytics/snapshots.server";
import {
  loadDashboardViewerContext,
} from "@/lib/analytics/viewer-context.server";
import { loadDashboardTrainStatus } from "@/lib/dashboard/train-status.server";
import { loadVideoUploadCoverage } from "@/lib/dashboard/video-upload-coverage.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadMembersAttentionSummary } from "@/lib/members/members-attention-summary.server";
import { loadReminderInboxForUser } from "@/lib/eur/satisfaction";
import { getRbacContext, sessionHasPermission } from "@/lib/rbac/context";
import { getDb, schema } from "@/lib/db";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  listAllianceSeasonVrForLeaderboard,
  resolveSeasonKey,
} from "@/lib/vr/repository";
import { loadSession, getAshedConnection } from "@/lib/session";

import type { DashboardSummaryPayload } from "@/lib/analytics/dashboard-summary.shared";

export async function loadDashboardSummary(
  sessionId: string,
  commanderIndex?: CommanderIndexPayload,
): Promise<DashboardSummaryPayload> {
  const session = await loadSession(sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId ?? null;
  if (!session?.hqUserId || !allianceId) {
    throw new Error("No alliance context");
  }

  const ctx = await getRbacContext(sessionId);
  const permissions = ctx?.permissions ?? new Set<string>();
  const canWriteMembers = permissions.has("members:write");
  const canManageTrains = permissions.has("trains:write");

  const commanderIndexResolved =
    commanderIndex ?? (await loadCommanderIndex(sessionId));

  const [
    viewer,
    inboxRows,
    attention,
    trainStatus,
    videoCoverage,
    squad,
    latestSnapshot,
    snapshotSeries,
    effectiveSeason,
    ashedConnection,
  ] = await Promise.all([
    loadDashboardViewerContext(
      sessionId,
      session.hqUserId,
      allianceId,
      commanderIndexResolved,
    ),
    permissions.has("inbox:read")
      ? loadReminderInboxForUser({
          hqUserId: session.hqUserId,
          allianceId,
          permissions,
        })
      : Promise.resolve([]),
    canWriteMembers
      ? loadMembersAttentionSummary(sessionId)
      : Promise.resolve(null),
    loadDashboardTrainStatus(allianceId),
    loadVideoUploadCoverage(allianceId),
    Promise.resolve(loadSquadSummaryFromCommanderIndex(commanderIndexResolved)),
    loadLatestSnapshot(allianceId),
    loadSnapshotSeries(allianceId, "90d"),
    getEffectiveSeasonForAlliance(allianceId),
    getAshedConnection(sessionId),
  ]);

  return {
    viewer,
    inbox: inboxRows.slice(0, 5).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      href: item.href,
      scoreTarget: item.scoreTarget,
      createdAt: item.createdAt.toISOString(),
    })),
    attention,
    trainStatus,
    videoCoverage,
    squad,
    latestSnapshot,
    linkProgressSeries: snapshotSeries,
    thpSeries: snapshotSeries,
    donationSeries: snapshotSeries,
    vrAvailable: !effectiveSeason.isPostSeason,
    canManageTrains,
    canWriteMembers,
    hasAshedConnection: ashedConnection !== null,
  };
}

export async function loadHeroPowerDashboard(
  sessionId: string,
  rangeRaw: string | null,
) {
  const session = await loadSession(sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId ?? null;
  if (!session?.hqUserId || !allianceId) {
    throw new Error("No alliance context");
  }

  const range = parseDashboardRange(rangeRaw);
  const today = getServerCalendarDate();
  const [viewer, series, table] = await Promise.all([
    loadDashboardViewerContext(sessionId, session.hqUserId, allianceId),
    loadSnapshotSeries(allianceId, range),
    loadMemberThpTable(allianceId, today),
  ]);

  const thpValues = await loadThpValuesForDate(allianceId, today);
  const standing = computeViewerThpStanding(thpValues, viewer.totalHeroPower);

  return { viewer, series, table, standing, range, today };
}

export async function loadLinkingDashboard(
  sessionId: string,
  rangeRaw: string | null,
) {
  const session = await loadSession(sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId ?? null;
  if (!session?.hqUserId || !allianceId) {
    throw new Error("No alliance context");
  }

  const range = parseDashboardRange(rangeRaw);
  const canWriteMembers = await sessionHasPermission(sessionId, "members:write");
  const [viewer, series, unlinkedMembers] = await Promise.all([
    loadDashboardViewerContext(sessionId, session.hqUserId, allianceId),
    loadSnapshotSeries(allianceId, range),
    canWriteMembers ? loadUnlinkedMembersForOfficers(sessionId) : Promise.resolve([]),
  ]);

  const latest = series.at(-1) ?? null;
  return {
    viewer,
    series,
    latest,
    unlinkedMembers: unlinkedMembers.map((row) => ({
      ashedMemberId: row.ashedMemberId,
      memberName: row.memberName,
      totalHeroPower: row.totalHeroPower,
    })),
    canWriteMembers,
    range,
  };
}

export async function loadDonationsDashboard(
  sessionId: string,
  rangeRaw: string | null,
) {
  const session = await loadSession(sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId ?? null;
  if (!session?.hqUserId || !allianceId) {
    throw new Error("No alliance context");
  }

  const range = parseDashboardRange(rangeRaw);
  const [viewer, series, ashedConnection] = await Promise.all([
    loadDashboardViewerContext(sessionId, session.hqUserId, allianceId),
    loadSnapshotSeries(allianceId, range),
    getAshedConnection(sessionId),
  ]);

  return {
    viewer,
    series,
    range,
    hasAshedConnection: ashedConnection !== null,
  };
}

export async function loadViralResistanceDashboard(
  sessionId: string,
  commanderIndex?: CommanderIndexPayload,
) {
  const session = await loadSession(sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId ?? null;
  if (!session?.hqUserId || !allianceId) {
    throw new Error("No alliance context");
  }

  const effectiveSeason = await getEffectiveSeasonForAlliance(allianceId);
  if (effectiveSeason.isPostSeason) {
    return { available: false as const };
  }

  const db = getDb();
  const seasonKey = await resolveSeasonKey(allianceId);
  const [viewer, memberCount, seasonRows] = await Promise.all([
    loadDashboardViewerContext(
      sessionId,
      session.hqUserId,
      allianceId,
      commanderIndex,
    ),
    db
      .select({ id: schema.allianceMembers.ashedMemberId })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, allianceId),
          eq(schema.allianceMembers.status, "active"),
        ),
      ),
    listAllianceSeasonVrForLeaderboard(allianceId, seasonKey),
  ]);

  const reporterValues = seasonRows
    .map((row) => row.highestBaseVr)
    .filter((value): value is number => typeof value === "number" && value > 0);

  const standing =
    viewer.highestBaseVr != null
      ? computePercentile(reporterValues, viewer.highestBaseVr)
      : null;

  return {
    available: true as const,
    viewer,
    reporterCount: reporterValues.length,
    activeMemberCount: memberCount.length,
    values: reporterValues,
    standing,
  };
}

export async function loadDashboardInitialData(sessionId: string): Promise<{
  summary: DashboardSummaryPayload;
  vr: Awaited<ReturnType<typeof loadViralResistanceDashboard>>;
}> {
  const commanderIndex = await loadCommanderIndex(sessionId);
  const summary = await loadDashboardSummary(sessionId, commanderIndex);
  const vr = summary.vrAvailable
    ? await loadViralResistanceDashboard(sessionId, commanderIndex)
    : { available: false as const };
  return { summary, vr };
}
