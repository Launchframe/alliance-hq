import { getLocale } from "next-intl/server";
import { standalonePageMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

import { GetStartedClient } from "@/components/auth/GetStartedClient";
import { requireAuthForPage } from "@/lib/auth/page-guard";
import { redirect } from "@/i18n/navigation";
import { getPageSessionState } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("getStarted");
  return standalonePageMetadata(t("title"));
}
export default async function GetStartedPage() {
  const locale = await getLocale();
  await requireAuthForPage("/get-started");
  const state = await getPageSessionState("/get-started", locale);

  if (state.hasAppAccess) {
    redirect({ href: "/dashboard", locale });
  }

  return <GetStartedClient />;
}
