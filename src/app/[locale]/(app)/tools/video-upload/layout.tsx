import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export default async function VideoUploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession("/tools/video-upload");
  await requirePagePermission(session.id, "hq:video:enqueue");
  return children;
}
