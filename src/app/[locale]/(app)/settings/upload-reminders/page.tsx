import { redirect } from "@/i18n/navigation";

import { UploadRemindersClient } from "@/components/settings/UploadRemindersClient";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { getRbacContext } from "@/lib/rbac/context";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UploadRemindersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/upload-reminders");
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return <AllianceContextRequired alliances={access.pickAlliance} />;
  }

  const rbac = await getRbacContext(access.session.id);
  if (!rbac?.permissions.has("inbox:read")) {
    redirect({ href: "/settings", locale });
    throw new Error("Forbidden");
  }

  const canManageSchedules = rbac.permissions.has("eur:schedules:write");

  return <UploadRemindersClient canManageSchedules={canManageSchedules} />;
}
