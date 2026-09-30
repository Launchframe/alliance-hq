import { getLocale, getTranslations } from "next-intl/server";

import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("teamWork");
  return allianceScopedMetadata(t("title"));
}
export default async function TeamWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  await requirePageSession("/team-work");
  const params = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]]));
  params.set("view", "workQueue");
  redirect({ href: `/notes?${params}`, locale });
}
