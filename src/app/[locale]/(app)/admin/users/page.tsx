import { AdminUsersConsole } from "@/components/admin/AdminUsersConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("usersTitle"));
}
export default function AdminUsersPage() {
  return <AdminUsersConsole />;
}
