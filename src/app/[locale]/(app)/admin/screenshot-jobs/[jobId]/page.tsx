import { AdminScreenshotJobDetailView } from "./AdminScreenshotJobDetailView";

type Props = {
  params: Promise<{ jobId: string }>;
};

export default async function AdminScreenshotJobDetailPage({ params }: Props) {
  const { jobId } = await params;
  return <AdminScreenshotJobDetailView jobId={jobId} />;
}
