import { VideoJobsConsolePage } from "@/components/video/VideoJobsConsolePage";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("videoJobsTitle"));
}
export default function AdminVideoJobsPage() {
  return <VideoJobsConsolePage />;
}
