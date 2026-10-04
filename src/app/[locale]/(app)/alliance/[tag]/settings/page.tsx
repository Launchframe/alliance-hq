import { redirect } from "@/i18n/navigation";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return await allianceScopedMetadata(t("titleAlliance"));
}
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
