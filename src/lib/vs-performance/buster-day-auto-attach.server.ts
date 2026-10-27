import "server-only";

import { attachBusterDaySnapshotJob } from "@/lib/vs-performance/buster-day-reports.server";
import { resolveBusterDaySnapshotAttach } from "@/lib/vs-performance/buster-day-auto-attach.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

/**
 * After a successful roster / alliance-kills video submit on Fri or Sun,
 * attach the job id onto this week's `buster_day_reports` row so the wizard
 * can mark the snapshot complete.
 */
export async function maybeAttachBusterDaySnapshotFromVideoSubmit(input: {
  allianceId: string;
  jobId: string;
  scoreTargetId: string;
  recordedDate?: string | null;
}): Promise<{ attached: boolean }> {
  const plan = resolveBusterDaySnapshotAttach({
    scoreTargetId: input.scoreTargetId,
    serverDate: getServerCalendarDate(),
    recordedDate: input.recordedDate,
  });
  if (!plan) return { attached: false };

  const result = await attachBusterDaySnapshotJob({
    allianceId: input.allianceId,
    vsWeekMonday: plan.vsWeekMonday,
    kind: plan.kind,
    rosterJobId: plan.jobField === "rosterJobId" ? input.jobId : undefined,
    killsJobId: plan.jobField === "killsJobId" ? input.jobId : undefined,
  });

  if (!result.ok) {
    console.error("[buster-day] auto-attach failed", {
      allianceId: input.allianceId,
      jobId: input.jobId,
      scoreTargetId: input.scoreTargetId,
      error: result.error,
      status: result.status,
    });
    return { attached: false };
  }
  return { attached: true };
}
