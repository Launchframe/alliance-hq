import { AdminVideoAnalyticsView } from "./AdminVideoAnalyticsView";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin.analyticsPage");
  return adminScopedMetadata(t("title"));
}
export default function AdminVideoAnalyticsPage() {
  return <AdminVideoAnalyticsView />;
}
