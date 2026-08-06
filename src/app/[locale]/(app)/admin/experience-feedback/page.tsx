import { AdminSurveyFeedbackConsole } from "@/components/admin/AdminSurveyFeedbackConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("experienceFeedbackPage.title"));
}
export default function AdminExperienceFeedbackPage() {
  return <AdminSurveyFeedbackConsole />;
}
