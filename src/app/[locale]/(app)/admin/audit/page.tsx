import { AdminAuditConsole } from "@/components/admin/AdminAuditConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("auditTitle"));
}
export default function AdminAuditPage() {
  return <AdminAuditConsole />;
}
