import { and, desc, eq, lt, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { countOpenMemberLinkHelpRequests } from "@/lib/member-link/member-link-help-queue.server";

export const OPS_INBOX_STUCK_QUEUED_MINUTES = 15;

export type OpsInboxItemKind =
  | "video_job_failed"
  | "video_job_stuck_queued"
  | "bug_report_open"
  | "member_link_help_open";

export type OpsInboxItem = {
  id: string;
  kind: OpsInboxItemKind;
  title: string;
  subtitle: string | null;
  href: string;
  createdAt: Date;
};

export type OpsInboxSummary = {
  total: number;
  videoJobsFailed: number;
  videoJobsStuckQueued: number;
  bugReportsOpen: number;
  memberLinkHelpOpen: number;
};

function stuckQueuedBefore(): Date {
  return new Date(Date.now() - OPS_INBOX_STUCK_QUEUED_MINUTES * 60 * 1000);
}

export async function loadOpsInboxSummary(): Promise<OpsInboxSummary> {
  const db = getDb();
  const stuckBefore = stuckQueuedBefore();

  const [failedRow, stuckRow, openBugsRow, memberLinkHelpOpen] =
    await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.status, "failed")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.status, "queued"),
          lt(schema.videoJobs.createdAt, stuckBefore),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.userFeedbackReport)
      .where(
        and(
          eq(schema.userFeedbackReport.type, "bug"),
          eq(schema.userFeedbackReport.status, "open"),
        ),
      ),
    countOpenMemberLinkHelpRequests(),
  ]);

  const videoJobsFailed = failedRow[0]?.count ?? 0;
  const videoJobsStuckQueued = stuckRow[0]?.count ?? 0;
  const bugReportsOpen = openBugsRow[0]?.count ?? 0;

  return {
    videoJobsFailed,
    videoJobsStuckQueued,
    bugReportsOpen,
    memberLinkHelpOpen,
    total:
      videoJobsFailed +
      videoJobsStuckQueued +
      bugReportsOpen +
      memberLinkHelpOpen,
  };
}

export async function loadOpsInboxItems(limit = 50): Promise<OpsInboxItem[]> {
  const db = getDb();
  const stuckBefore = stuckQueuedBefore();
  const perKind = Math.ceil(limit / 4);

  const [failedJobs, stuckJobs, openBugs, openHelp] = await Promise.all([
    db
      .select({
        id: schema.videoJobs.id,
        fileName: schema.videoJobs.fileName,
        scoreTarget: schema.videoJobs.scoreTarget,
        errorMessage: schema.videoJobs.errorMessage,
        createdAt: schema.videoJobs.createdAt,
      })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.status, "failed"))
      .orderBy(desc(schema.videoJobs.createdAt))
      .limit(perKind),
    db
      .select({
        id: schema.videoJobs.id,
        fileName: schema.videoJobs.fileName,
        scoreTarget: schema.videoJobs.scoreTarget,
        createdAt: schema.videoJobs.createdAt,
      })
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.status, "queued"),
          lt(schema.videoJobs.createdAt, stuckBefore),
        ),
      )
      .orderBy(desc(schema.videoJobs.createdAt))
      .limit(perKind),
    db
      .select({
        id: schema.userFeedbackReport.id,
        subject: schema.userFeedbackReport.subject,
        area: schema.userFeedbackReport.area,
        createdAt: schema.userFeedbackReport.createdAt,
      })
      .from(schema.userFeedbackReport)
      .where(
        and(
          eq(schema.userFeedbackReport.type, "bug"),
          eq(schema.userFeedbackReport.status, "open"),
        ),
      )
      .orderBy(desc(schema.userFeedbackReport.createdAt))
      .limit(perKind),
    db
      .select({
        id: schema.hqMemberLinkHelpRequests.id,
        requesterHandle: schema.hqMemberLinkHelpRequests.requesterHandle,
        gameUserName: schema.hqMemberLinkHelpRequests.gameUserName,
        context: schema.hqMemberLinkHelpRequests.context,
        allianceTag: schema.alliances.tag,
        createdAt: schema.hqMemberLinkHelpRequests.createdAt,
      })
      .from(schema.hqMemberLinkHelpRequests)
      .innerJoin(
        schema.alliances,
        eq(schema.alliances.id, schema.hqMemberLinkHelpRequests.allianceId),
      )
      .where(eq(schema.hqMemberLinkHelpRequests.status, "open"))
      .orderBy(desc(schema.hqMemberLinkHelpRequests.createdAt))
      .limit(perKind),
  ]);

  const items: OpsInboxItem[] = [
    ...failedJobs.map((job) => ({
      id: `failed:${job.id}`,
      kind: "video_job_failed" as const,
      title: job.fileName ?? job.id,
      subtitle: job.errorMessage ?? job.scoreTarget,
      href: `/admin/video-jobs/${job.id}`,
      createdAt: job.createdAt,
    })),
    ...stuckJobs.map((job) => ({
      id: `stuck:${job.id}`,
      kind: "video_job_stuck_queued" as const,
      title: job.fileName ?? job.id,
      subtitle: job.scoreTarget,
      href: `/admin/video-jobs/${job.id}`,
      createdAt: job.createdAt,
    })),
    ...openBugs.map((bug) => ({
      id: `bug:${bug.id}`,
      kind: "bug_report_open" as const,
      title: bug.subject ?? bug.id,
      subtitle: bug.area,
      href: `/admin/bug-reports`,
      createdAt: bug.createdAt,
    })),
    ...openHelp.map((help) => ({
      id: `help:${help.id}`,
      kind: "member_link_help_open" as const,
      title: help.gameUserName?.trim() || help.requesterHandle,
      subtitle: help.allianceTag ?? help.context,
      href: `/admin/member-link-help`,
      createdAt: help.createdAt,
    })),
  ];

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items.slice(0, limit);
}
