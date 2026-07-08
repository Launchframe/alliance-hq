import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { MyThpTrackerView } from "@/components/thp/my-thp-tracker-view";
import { loadMyThpForUser } from "@/lib/thp/web-thp.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("myThp");
  return { title: t("pageTitle") };
}

export default async function MyThpPage() {
  const session = await requirePageSession("/my-thp");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    redirect("/get-started");
  }

  const initial = await loadMyThpForUser({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!initial) {
    redirect("/onboard?next=%2Fmy-thp");
  }

  return <MyThpTrackerView initial={initial} />;
}
