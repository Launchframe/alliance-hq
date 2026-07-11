import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BankManagementClient } from "@/components/banks/BankManagementClient";
import { loadBankManagementDashboard } from "@/lib/banks/load-dashboard.server";
import { BANK_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("bankManagement");
  return { title: t("title") };
}

export default async function BankManagementPage() {
  const session = await requirePageSession("/bank-management");
  await requirePagePermission(session.id, BANK_READ_PERMISSION);
  const dashboard = await loadBankManagementDashboard(session.id);

  if (!dashboard || "forbidden" in dashboard) {
    notFound();
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-full">
      <BankManagementClient initial={dashboard} />
    </div>
  );
}
