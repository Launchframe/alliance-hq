import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { OFFICER_INTEL_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function OfficerChatSessionPage({ params }: Props) {
  const { id } = await params;
  const locale = await getLocale();
  const session = await requirePageSession(`/officer-intel/sessions/${id}`);
  await requirePagePermission(session.id, OFFICER_INTEL_READ_PERMISSION);
  redirect({ href: `/notes?view=chatLogs&chatLog=${encodeURIComponent(id)}`, locale });
}
