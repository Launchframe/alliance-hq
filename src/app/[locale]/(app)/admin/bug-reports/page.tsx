import { AdminBugReportsConsole } from "@/components/admin/AdminBugReportsConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("bugReportsPage.title"));
}
export default function AdminBugReportsPage() {
  return <AdminBugReportsConsole />;
}
