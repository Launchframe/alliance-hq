import { getTranslations } from "next-intl/server";

import { EventWorkspace } from "@/components/events/EventWorkspace";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("eventEvidence");
  return await allianceScopedMetadata(t("title"));
}

type Props = { params: Promise<{ eventId: string }> };

export default async function EventDetailPage({ params }: Props) {
  const { eventId } = await params;
  const session = await requirePageSession("/events");
  await requirePagePermission(session.id, "events:read");
  const [canWriteScores, canWriteEvents, canWriteTrains] = await Promise.all([
    sessionHasPermission(session.id, "scores:write"),
    sessionHasPermission(session.id, "hq:events:write"),
    sessionHasPermission(session.id, "trains:write"),
  ]);
  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <EventWorkspace
        eventId={eventId}
        canWriteScores={canWriteScores}
        canWriteEvents={canWriteEvents}
        canWriteTrains={canWriteTrains}
      />
    </div>
  );
}
