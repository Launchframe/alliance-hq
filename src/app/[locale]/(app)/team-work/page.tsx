import { getTranslations } from "next-intl/server";

import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";
import { locales } from "@/i18n/routing";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("teamWork");
  return allianceScopedMetadata(t("title"));
}
export default async function TeamWorkPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale: rawLocale } = await params;
  const locale = locales.includes(rawLocale as (typeof locales)[number]) ? rawLocale : "en-US";
  await requirePageSession("/team-work");
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]]));
  query.set("view", "workQueue");
  redirect({ href: `/notes?${query}`, locale });
}
