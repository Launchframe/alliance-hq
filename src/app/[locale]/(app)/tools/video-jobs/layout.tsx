import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { requirePageSession } from "@/lib/session";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";

export const dynamic = "force-dynamic";

export default async function ToolsVideoJobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const session = await requirePageSession("/tools/video-jobs");

  if (!(await sessionCanProcessVideo(session.id))) {
    redirect({ href: "/tools/video-upload/queue", locale });
  }

  return children;
}
