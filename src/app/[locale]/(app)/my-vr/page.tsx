import { getTranslations } from "next-intl/server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { redirect } from "next/navigation";

import { MyVrTrackerView } from "@/components/vr/my-vr-tracker-view";
import { loadMyVrForUser } from "@/lib/vr/web-vr.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("myVr");
  return await allianceScopedMetadata(t("pageTitle"));
}

export default async function MyVrPage() {
  const session = await requirePageSession("/my-vr");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    redirect("/get-started");
  }

  const initial = await loadMyVrForUser({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!initial) {
    redirect("/onboard?next=%2Fmy-vr");
  }

  return <MyVrTrackerView initial={initial} />;
}
