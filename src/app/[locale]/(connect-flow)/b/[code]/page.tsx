import { getTranslations } from "next-intl/server";

import { StoreTipCardShell } from "@/components/members/StoreTipCardShell";
import { StoreTipPublicClient } from "@/components/members/StoreTipPublicClient";
import { loadPublicTipLink } from "@/lib/members/commander-donation.server";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string; locale: string }>;
  searchParams: Promise<{ go?: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { code, locale } = await params;
  const t = await getTranslations({ locale, namespace: "storeTipPublic" });
  const tip = await loadPublicTipLink(code);
  return {
    title: tip
      ? t("tipPublicTitle", { name: tip.displayName })
      : t("tipPublicUnavailable"),
  };
}

export default async function StoreTipPublicPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const sp = await searchParams;
  const tip = await loadPublicTipLink(code);
  const t = await getTranslations("storeTipPublic");

  if (!tip) {
    return (
      <StoreTipCardShell>
        <p className="mt-6 text-lg text-slate-200">{t("tipPublicUnavailable")}</p>
      </StoreTipCardShell>
    );
  }

  return (
    <StoreTipPublicClient
      code={tip.code}
      displayName={tip.displayName}
      allianceTag={tip.allianceTag}
      autoOpen={sp.go === "1"}
    />
  );
}
