import { redirect } from "@/i18n/navigation";

import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Legacy path — redirect to session-scoped alliance settings hub. */
export default async function LegacyAllianceSettingsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePageSession("/settings/alliance");
  redirect({ href: "/settings", locale });
}
