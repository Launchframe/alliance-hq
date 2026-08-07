import { Suspense } from "react";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

import { AdminAlliancesConsole } from "@/components/admin/AdminAlliancesConsole";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("alliancesTitle"));
}
export default function AdminAlliancesPage() {
  return (
    <Suspense fallback={null}>
      <AdminAlliancesConsole />
    </Suspense>
  );
}
