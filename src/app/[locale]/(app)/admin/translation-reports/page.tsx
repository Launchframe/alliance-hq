import { AdminTranslationReportsConsole } from "@/components/admin/AdminTranslationReportsConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("translationReportsTitle"));
}
export default function AdminTranslationReportsPage() {
  return <AdminTranslationReportsConsole />;
}
