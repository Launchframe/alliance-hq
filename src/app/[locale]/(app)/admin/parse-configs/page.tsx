import { AdminParseConfigsView } from "./AdminParseConfigsView";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin.parseConfigsPage");
  return adminScopedMetadata(t("title"));
}
export default function AdminParseConfigsPage() {
  return <AdminParseConfigsView />;
}
