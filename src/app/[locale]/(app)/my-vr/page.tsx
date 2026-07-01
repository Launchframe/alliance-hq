import { redirect } from "next/navigation";

import { MyVrTrackerView } from "@/components/vr/my-vr-tracker-view";
import { MY_VR_COPY } from "@/components/vr/my-vr-copy.pending";
import { loadMyVrForUser } from "@/lib/vr/web-vr.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: MY_VR_COPY.pageTitle };
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
