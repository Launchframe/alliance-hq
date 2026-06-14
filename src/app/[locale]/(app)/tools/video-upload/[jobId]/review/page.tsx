import { ReviewExtractedData } from "@/components/video/ReviewExtractedData";

type Props = {
  params: Promise<{ jobId: string }>;
};

export default async function VideoReviewPage({ params }: Props) {
  const { jobId } = await params;
  return <ReviewExtractedData jobId={jobId} />;
}
