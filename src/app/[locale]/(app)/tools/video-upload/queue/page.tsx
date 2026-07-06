import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getAshedConnection, requirePageSession } from "@/lib/session";
import {
  isAllianceHqOcrOnlyLockedOnDeploy,
  loadEffectiveAllianceHqOcrOnly,
} from "@/lib/video/alliance-ocr-settings.server";
import { videoOcrRequiresAshedConnection } from "@/lib/video/ocr-provider.shared";
import {
  sessionCanProcessVideo,
  sessionCanReadAllianceVideoQueue,
} from "@/lib/video/processor-slots.server";
import { listVideoQueueJobsForSession } from "@/lib/video/video-queue.server";
import { VideoQueueClient } from "@/components/video/VideoQueueClient";

export const dynamic = "force-dynamic";

export default async function VideoQueuePage() {
  const locale = await getLocale();
  const session = await requirePageSession("/tools/video-upload/queue");

  if (!(await sessionCanReadAllianceVideoQueue(session.id))) {
    redirect({ href: "/tools/video-upload", locale });
  }

  const t = await getTranslations("videoQueue");

  const allianceId = resolveSessionAllianceId(session);

  const [jobs, canProcess, connection, hqOcrOnly, hqOcrOnlyLocked] = await Promise.all([
    listVideoQueueJobsForSession(session.id),
    sessionCanProcessVideo(session.id),
    getAshedConnection(session.id),
    allianceId ? loadEffectiveAllianceHqOcrOnly(allianceId) : Promise.resolve(false),
    Promise.resolve(isAllianceHqOcrOnlyLockedOnDeploy()),
  ]);

  const connectUrl = `/connect?next=${encodeURIComponent("/tools/video-upload/queue")}`;
  const envRequiresAshed = videoOcrRequiresAshedConnection();

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-4 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-hq-fg">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">
          {hqOcrOnly ? t("descriptionHqOcr") : t("description")}
        </p>
      </header>
      <VideoQueueClient
        initialJobs={jobs}
        canProcess={canProcess}
        ashedConnected={Boolean(connection)}
        envRequiresAshed={envRequiresAshed}
        initialHqOcrOnly={hqOcrOnly}
        initialHqOcrOnlyLocked={hqOcrOnlyLocked}
        connectUrl={connectUrl}
      />
    </div>
  );
}
