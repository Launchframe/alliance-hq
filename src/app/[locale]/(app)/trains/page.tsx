import { getTranslations } from "next-intl/server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";

import { TrainsDashboard } from "@/components/trains/TrainsDashboard";
import {
  parseTrainsHubDateParam,
  parseTrainsScoresReadyParam,
} from "@/lib/trains/guided-video-upload.shared";
import { defaultTrainsHubDate } from "@/lib/trains/conductor-invite.shared";
import {
  loadTrainsDashboard,
  loadWeekSchedulePage,
} from "@/lib/trains/load-dashboard";
import { getTrainWeekStart } from "@/lib/trains/train-week-calendar.shared";
import { getAshedConnection, requirePageSession } from "@/lib/session";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("trains");
  return await allianceScopedMetadata(t("title"));
}

type Props = {
  searchParams: Promise<{
    date?: string;
    scoresReady?: string;
    eventId?: string;
  }>;
};

export default async function TrainsPage({ searchParams }: Props) {
  const session = await requirePageSession("/trains");
  const [initial, sp, canProcessVideo, ashedConnection] = await Promise.all([
    loadTrainsDashboard(session.id),
    searchParams,
    sessionCanProcessVideo(session.id),
    getAshedConnection(session.id),
  ]);
  const requestedDate = parseTrainsHubDateParam(sp.date);
  const todayRecord =
    initial.conductorRecord?.date === initial.today
      ? initial.conductorRecord
      : null;
  const hubDate = defaultTrainsHubDate({
    today: initial.today,
    leadDays: initial.trainConductorLeadTimeDays,
    explicitDate: requestedDate,
    todayLockedAt: todayRecord?.lockedAt ?? null,
    now: new Date(),
  });
  // The dashboard payload is the week that contains today. Tomorrow can be
  // the next train week (default weeks start Tuesday, so this is Monday).
  const hubWeekStart = getTrainWeekStart(hubDate, {
    trainWeekStartDow: initial.trainWeekStartDow,
  });
  const initialViewedWeek =
    hubWeekStart === initial.weekStart
      ? null
      : await loadWeekSchedulePage(session.id, hubWeekStart);
  return (
    <TrainsDashboard
      initial={initial}
      initialSelectedDate={hubDate}
      initialViewedWeek={initialViewedWeek}
      initialEventId={sp.eventId?.trim() || null}
      initialScoresReady={parseTrainsScoresReadyParam(sp.scoresReady)}
      videoUpload={{
        canProcess: canProcessVideo,
        ashedConnected: Boolean(ashedConnection),
      }}
    />
  );
}
