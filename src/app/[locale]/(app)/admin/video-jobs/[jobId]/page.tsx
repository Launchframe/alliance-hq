import { AdminVideoJobDetailView } from "./AdminVideoJobDetailView";

type Props = {
  params: Promise<{ jobId: string }>;
};

export default async function AdminVideoJobDetailPage({ params }: Props) {
  const { jobId } = await params;
  return <AdminVideoJobDetailView jobId={jobId} />;
}
