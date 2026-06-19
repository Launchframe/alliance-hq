import { redirect } from "@/i18n/navigation";

import { allianceSettingsPath } from "@/lib/alliance/alliance-settings-path.shared";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Legacy path — redirect to tag-scoped alliance settings. */
export default async function LegacyAllianceSettingsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/alliance");

  if (session.allianceTag) {
    redirect({ href: allianceSettingsPath(session.allianceTag), locale });
  }

  redirect({ href: "/settings", locale });
}
