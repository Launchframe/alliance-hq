import { AdminRosterDuplicatesConsole } from "@/components/admin/AdminRosterDuplicatesConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin.rosterDuplicates");
  return adminScopedMetadata(t("title"));
}

export default function AdminRosterDuplicatesPage() {
  return <AdminRosterDuplicatesConsole />;
}
