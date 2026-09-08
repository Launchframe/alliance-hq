import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { RegularEventAshedPage } from "@/components/regular-events/RegularEventAshedPage";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { resolveAshedPath, resolveIframePage } from "@/lib/nav/routes";
import { resolveAllianceTagForSession } from "@/lib/settings/alliance-settings-access.server";
import { getSessionStateFor, requirePageSession } from "@/lib/session";
import { getScoreTargetIdForNavHref } from "@/lib/video/score-target-nav";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return await allianceScopedMetadata(t("zombieSiege"));
}

export default async function ZombieSiegePage() {
  const locale = await getLocale();
  const session = await requirePageSession("/zombie-siege");
  const state = await getSessionStateFor(session, locale);
  if (!state.canUseAshedEmbeds) {
    redirect({ href: "/members", locale });
  }

  const route = resolveIframePage("zombie-siege");
  const ashedPath = route ? resolveAshedPath(route) : undefined;
  if (!route || !ashedPath) {
    notFound();
  }

  const allianceTag = await resolveAllianceTagForSession(session);
  if (!allianceTag) {
    redirect({ href: "/settings/regular-events", locale });
    throw new Error("Missing alliance");
  }

  return (
    <RegularEventAshedPage
      allianceTag={allianceTag}
      ashedPath={ashedPath}
      labelKey={route.labelKey}
      scoreTargetId={getScoreTargetIdForNavHref(route.href)}
      filterEventKey="zombie_siege"
    />
  );
}
