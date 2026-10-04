import { getTranslations } from "next-intl/server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { notFound } from "next/navigation";

import { CityListImportReviewClient } from "@/components/banks/CityListImportReviewClient";
import { loadBankManagementDashboard } from "@/lib/banks/load-dashboard.server";
import { BANK_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("bankManagement");
  return await allianceScopedMetadata(t("cityListReviewPageTitle"));
}

export default async function CityListImportReviewPage() {
  const session = await requirePageSession("/bank-management/import-review");
  await requirePagePermission(session.id, BANK_WRITE_PERMISSION);
  const dashboard = await loadBankManagementDashboard(session.id);

  if (!dashboard || "forbidden" in dashboard) {
    notFound();
  }

  return (
    <CityListImportReviewClient
      allianceId={dashboard.allianceId}
      existingBanks={dashboard.banks}
      canWrite={dashboard.canWrite}
    />
  );
}
