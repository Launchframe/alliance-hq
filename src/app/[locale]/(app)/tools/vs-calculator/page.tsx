import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { VsCalculatorView } from "@/components/vs-calculator/vs-calculator-view";
import { requirePageSession } from "@/lib/session";
import { loadVsCalculatorForUser } from "@/lib/vs-calculator/web-vs-calculator-read.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("vsCalculator");
  return { title: t("pageTitle") };
}

export default async function VsCalculatorPage() {
  const session = await requirePageSession("/tools/vs-calculator");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    redirect("/get-started");
  }

  const initial = await loadVsCalculatorForUser({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!initial) {
    redirect("/onboard?next=%2Ftools%2Fvs-calculator");
  }

  return <VsCalculatorView initial={initial} />;
}
