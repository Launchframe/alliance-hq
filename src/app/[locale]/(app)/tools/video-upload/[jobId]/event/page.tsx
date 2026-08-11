import { ReviewExtractedData } from "@/components/video/ReviewExtractedData";
import { videoJobMetadataForJobId } from "@/lib/metadata/generate-page-metadata.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

type MetadataProps = { params: Promise<{ jobId: string }> };

export async function generateMetadata({ params }: MetadataProps) {
  const { jobId } = await params;
  return await videoJobMetadataForJobId(jobId);
}
export default async function VideoEventPage({ params }: Props) {
  const { jobId } = await params;
  return <ReviewExtractedData jobId={jobId} viewMode="event" />;
}
