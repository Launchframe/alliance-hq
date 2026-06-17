import { AdminExperimentDetailView } from "./AdminExperimentDetailView";

type Props = {
  params: Promise<{ campaignId: string }>;
};

export default async function AdminExperimentDetailPage({ params }: Props) {
  const { campaignId } = await params;
  return <AdminExperimentDetailView campaignId={campaignId} />;
}
