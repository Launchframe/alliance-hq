import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { getAshedConnection, requirePageSession } from "@/lib/session";
import { videoOcrRequiresAshedConnection } from "@/lib/video/ocr-provider.shared";
import {
  sessionCanProcessVideo,
  sessionCanReadAllianceVideoQueue,
} from "@/lib/video/processor-slots.server";
import { listAllianceActiveVideoJobs } from "@/app/api/tools/video-upload/queue/route";
import { VideoQueueClient } from "@/components/video/VideoQueueClient";

export const dynamic = "force-dynamic";

export default async function VideoQueuePage() {
  const locale = await getLocale();
  const session = await requirePageSession("/tools/video-upload/queue");

  if (!(await sessionCanReadAllianceVideoQueue(session.id))) {
    redirect({ href: "/tools/video-upload", locale });
  }

  const t = await getTranslations("videoQueue");

  const [jobs, canProcess, connection] = await Promise.all([
    session.currentAllianceId
      ? listAllianceActiveVideoJobs(session.currentAllianceId)
      : Promise.resolve([]),
    sessionCanProcessVideo(session.id),
    getAshedConnection(session.id),
  ]);

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-4 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h1>
        <p className="text-sm text-[#8b949e]">{t("description")}</p>
      </header>
      <VideoQueueClient
        initialJobs={jobs}
        canProcess={canProcess}
        ashedConnected={Boolean(connection)}
        ashedRequired={videoOcrRequiresAshedConnection()}
        connectUrl="/connect"
      />
    </div>
  );
}
