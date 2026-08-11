import { BankLifecycleGuideHub } from "@/components/guides/BankLifecycleGuideHub";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePageSession } from "@/lib/session";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guides.bankLifecycle" });

  const meta = await allianceScopedMetadata(t("hub.title"));
  return { ...meta, description: t("hub.subtitle") };
}

export default async function BankLifecycleGuideHubPage() {
  await requirePageSession("/guides/bank-lifecycle");

  return (
    <div className="min-w-0">
      <BankLifecycleGuideHub />
    </div>
  );
}
