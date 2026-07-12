import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { MyKillsTrackerView } from "@/components/kills/my-kills-tracker-view";
import { loadMyKillsForUser } from "@/lib/kills/web-kills-read.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("myKills");
  return { title: t("pageTitle") };
}

export default async function MyKillsPage() {
  const session = await requirePageSession("/my-kills");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    redirect("/get-started");
  }

  const initial = await loadMyKillsForUser({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!initial) {
    redirect("/onboard?next=%2Fmy-kills");
  }

  return <MyKillsTrackerView initial={initial} />;
}
