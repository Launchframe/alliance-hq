import { AdminExperimentDetailView } from "./AdminExperimentDetailView";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

type Props = {
  params: Promise<{ campaignId: string }>;
};

type MetadataProps = { params: Promise<{ campaignId: string }> };

export async function generateMetadata({ params }: MetadataProps) {
  const { campaignId } = await params;
  const t = await getTranslations("admin.experimentsPage");
  return adminScopedMetadata(`${t("title")} — ${campaignId}`);
}
export default async function AdminExperimentDetailPage({ params }: Props) {
  const { campaignId } = await params;
  return <AdminExperimentDetailView campaignId={campaignId} />;
}
