import { getTranslations } from "next-intl/server";

import { BusterDayWizardClient } from "@/components/vs-performance/BusterDayWizardClient";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("busterDay");
  return { title: t("title") };
}

export default async function BusterDayWizardPage() {
  const session = await requirePageSession("/vs-performance/buster-day");
  await requirePagePermission(session.id, "scores:read", "/members");

  return (
    <div className="px-4 py-6 md:px-0">
      <BusterDayWizardClient />
    </div>
  );
}
