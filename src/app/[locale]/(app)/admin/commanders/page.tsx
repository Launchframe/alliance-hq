import { AdminCommandersConsole } from "@/components/admin/AdminCommandersConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("commandersTitle"));
}
export default function AdminCommandersPage() {
  return <AdminCommandersConsole />;
}
