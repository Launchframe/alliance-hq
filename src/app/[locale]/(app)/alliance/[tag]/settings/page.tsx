import { redirect } from "@/i18n/navigation";

import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Legacy tag-scoped alliance settings — redirect to session hub. */
export default async function LegacyTagAllianceSettingsRedirect({
  params,
}: {
  params: Promise<{ locale: string; tag: string }>;
}) {
  const { locale, tag } = await params;
  await requirePageSession(`/alliance/${tag}/settings`);
  redirect({ href: "/settings", locale });
}
