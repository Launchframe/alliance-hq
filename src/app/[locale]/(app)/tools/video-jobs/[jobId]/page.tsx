import { AdminVideoJobDetailView } from "@/app/[locale]/(app)/admin/video-jobs/[jobId]/AdminVideoJobDetailView";
import { videoJobMetadataForJobId } from "@/lib/metadata/generate-page-metadata.server";
import { TOOLS_VIDEO_JOBS_CONSOLE } from "@/lib/video/video-jobs-console.shared";

type Props = {
  params: Promise<{ jobId: string }>;
};

type MetadataProps = { params: Promise<{ jobId: string }> };

export async function generateMetadata({ params }: MetadataProps) {
  const { jobId } = await params;
  return await videoJobMetadataForJobId(jobId);
}
export default async function ToolsVideoJobDetailPage({ params }: Props) {
  const { jobId } = await params;
  return (
    <AdminVideoJobDetailView jobId={jobId} config={TOOLS_VIDEO_JOBS_CONSOLE} />
  );
}
