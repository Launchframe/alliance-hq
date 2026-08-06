import { AdminSystemConsole } from "@/components/admin/AdminSystemConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("systemTitle"));
}
export default function AdminSystemPage() {
  return <AdminSystemConsole />;
}
