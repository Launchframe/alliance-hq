import { AdminUidInspectorConsole } from "@/components/admin/AdminUidInspectorConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin.uidInspectorPage");
  return adminScopedMetadata(t("title"));
}
export default function AdminUidInspectorPage() {
  return <AdminUidInspectorConsole />;
}
