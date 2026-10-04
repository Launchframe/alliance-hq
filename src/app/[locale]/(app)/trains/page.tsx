import { getTranslations } from "next-intl/server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";

import { TrainsDashboard } from "@/components/trains/TrainsDashboard";
import {
  parseTrainsHubDateParam,
  parseTrainsScoresReadyParam,
} from "@/lib/trains/guided-video-upload.shared";
import { loadTrainsDashboard } from "@/lib/trains/load-dashboard";
import { requirePageSession } from "@/lib/session";

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
  const [initial, sp] = await Promise.all([
    loadTrainsDashboard(session.id),
    searchParams,
  ]);
  return (
    <TrainsDashboard
      initial={initial}
      initialSelectedDate={parseTrainsHubDateParam(sp.date)}
      initialEventId={sp.eventId?.trim() || null}
      initialScoresReady={parseTrainsScoresReadyParam(sp.scoresReady)}
    />
  );
}
