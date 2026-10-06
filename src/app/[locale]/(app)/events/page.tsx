import { getTranslations } from "next-intl/server";

import { EventsCatalogClient } from "@/components/events/EventsCatalogClient";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("eventEvidence");
  return await allianceScopedMetadata(t("title"));
}

export default async function EventsPage() {
  const session = await requirePageSession("/events");
  await requirePagePermission(session.id, "events:read");
  const t = await getTranslations("eventEvidence");
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-hq-fg">{t("title")}</h1>
      <EventsCatalogClient />
    </div>
  );
}
