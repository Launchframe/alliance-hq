import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { VideoProcessorsPanel } from "@/components/settings/VideoProcessorsPanel";
import { sessionHasActiveMembership } from "@/lib/native-alliance/access";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import {
  sessionHasPermission,
  sessionIsAllianceAdmin,
} from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";
import {
  MAX_VIDEO_PROCESSORS,
  listAllianceVideoProcessors,
  listVideoProcessorCandidates,
} from "@/lib/video/processor-slots.server";
import {
  videoProcessorEligibilityModeForOperatingMode,
  type VideoProcessorCandidate,
  type VideoProcessorEligibilityMode,
} from "@/lib/video/processor-slots.shared";

export const dynamic = "force-dynamic";

export default async function VideoProcessorsPage() {
  const locale = await getLocale();
  const session = await requirePageSession("/tools/video-processors");
  const t = await getTranslations("videoProcessors");

  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    redirect({ href: "/tools/video-upload", locale });
    throw new Error("Alliance context required.");
  }
  const hasMembership = await sessionHasActiveMembership(session);
  const isPlatformMaintainer = await sessionHasPermission(session.id, "hq:admin");
  if (!hasMembership && !isPlatformMaintainer) {
    redirect({ href: "/tools/video-upload", locale });
  }

  const canManage = await sessionIsAllianceAdmin(session.id);
  const processors = await listAllianceVideoProcessors(allianceId);

  let candidates: VideoProcessorCandidate[] = [];
  let eligibilityMode: VideoProcessorEligibilityMode =
    videoProcessorEligibilityModeForOperatingMode(
      await getAllianceOperatingMode(allianceId),
    );

  if (canManage) {
    const candidateList = await listVideoProcessorCandidates(allianceId);
    const processorIds = new Set(processors.map((p) => p.hqUserId));
    candidates = candidateList.candidates.filter(
      (c) => !processorIds.has(c.hqUserId),
    );
    eligibilityMode = candidateList.eligibilityMode;
  }

  return (
    <div className="mx-auto min-w-0 max-w-3xl space-y-4 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h1>
        <p className="text-sm text-[#8b949e]">{t("pageDescription")}</p>
      </header>
      <VideoProcessorsPanel
        initialProcessors={processors}
        initialCandidates={candidates}
        eligibilityMode={eligibilityMode}
        max={MAX_VIDEO_PROCESSORS}
        readOnly={!canManage}
      />
    </div>
  );
}
