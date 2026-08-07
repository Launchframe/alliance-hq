import { redirect } from "@/i18n/navigation";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return await allianceScopedMetadata(t("titleAlliance"));
}
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
