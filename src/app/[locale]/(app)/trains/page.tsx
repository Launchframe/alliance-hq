import { getTranslations } from "next-intl/server";

import { TrainsDashboard } from "@/components/trains/TrainsDashboard";
import { loadTrainsDashboard } from "@/lib/trains/load-dashboard";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("trains");
  return { title: t("title") };
}

export default async function TrainsPage() {
  const session = await requirePageSession("/trains");
  const initial = await loadTrainsDashboard(session.id);
  return <TrainsDashboard initial={initial} />;
}
