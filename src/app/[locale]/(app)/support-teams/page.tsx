import { getLocale, getTranslations } from "next-intl/server";

import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("supportTeams");
  return allianceScopedMetadata(t("title"));
}
export default async function SupportTeamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  await requirePageSession("/support-teams");
  const params = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]]));
  params.set("view", "teams");
  redirect({ href: `/notes?${params}`, locale });
}
