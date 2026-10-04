import { redirect } from "next/navigation";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("professions");
  return await allianceScopedMetadata(t("officerTitle"));
}
export default async function ProfessionsOfficerRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/professions?tab=officer`);
}
