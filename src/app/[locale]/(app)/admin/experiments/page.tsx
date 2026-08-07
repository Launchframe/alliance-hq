import { AdminExperimentsView } from "./AdminExperimentsView";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin.experimentsPage");
  return adminScopedMetadata(t("title"));
}
export default function AdminExperimentsPage() {
  return <AdminExperimentsView />;
}
