import { AshedEmbed } from "@/components/AshedEmbed";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";
import { resolveAshedPath, resolveIframePage } from "@/lib/nav/routes";
import { getSessionStateFor, requirePageSession } from "@/lib/session";
import { getScoreTargetIdForNavHref } from "@/lib/video/score-target-nav";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

type Props = {
  params: Promise<{ page: string }>;
};

type MetadataProps = { params: Promise<{ page: string }> };

export async function generateMetadata({ params }: MetadataProps) {
  const { page } = await params;
  const route = resolveIframePage(page);
  if (!route) {
    return await allianceScopedMetadata(page);
  }
  const t = await getTranslations("nav");
  return await allianceScopedMetadata(t(route.labelKey));
}
export default async function IframeNavPage({ params }: Props) {
  const locale = await getLocale();
  const session = await requirePageSession("/");
  const state = await getSessionStateFor(session, locale);
  if (!state.canUseAshedEmbeds) {
    redirect({ href: "/members", locale });
  }

  const { page } = await params;
  const route = resolveIframePage(page);
  const ashedPath = route ? resolveAshedPath(route) : undefined;
  if (!route || !ashedPath) {
    notFound();
  }

  return (
    <AshedEmbed
      path={ashedPath}
      labelKey={route.labelKey}
      scoreTargetId={getScoreTargetIdForNavHref(route.href)}
    />
  );
}
