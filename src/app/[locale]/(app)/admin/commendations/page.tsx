import { AdminCommendationsConsole } from "@/components/admin/AdminCommendationsConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("commendationsTitle"));
}
export default function AdminCommendationsPage() {
  return <AdminCommendationsConsole />;
}
