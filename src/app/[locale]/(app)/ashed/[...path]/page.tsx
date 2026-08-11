import { redirect } from "@/i18n/navigation";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";
import { legacyAshedRedirect } from "@/lib/nav/routes";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ locale: string; path?: string[] }>;
};

export async function generateMetadata() {
  const t = await getTranslations("navGroups");
  return await allianceScopedMetadata(t("allianceManagement"));
}
export default async function LegacyAshedPage({ params }: Props) {
  const { locale, path = [] } = await params;
  const target = legacyAshedRedirect(path);
  if (!target) {
    notFound();
  }
  redirect({ href: target, locale });
}
