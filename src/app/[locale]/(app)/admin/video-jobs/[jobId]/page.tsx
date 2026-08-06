import { AdminVideoJobDetailView } from "./AdminVideoJobDetailView";
import { videoJobMetadataForJobId } from "@/lib/metadata/generate-page-metadata.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

type MetadataProps = { params: Promise<{ jobId: string }> };

export async function generateMetadata({ params }: MetadataProps) {
  const { jobId } = await params;
  return await videoJobMetadataForJobId(jobId);
}
export default async function AdminVideoJobDetailPage({ params }: Props) {
  const { jobId } = await params;
  return <AdminVideoJobDetailView jobId={jobId} />;
}
