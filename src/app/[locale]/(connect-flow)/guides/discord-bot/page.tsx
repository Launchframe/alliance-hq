import { DiscordBotGuideHub } from "@/components/guides/DiscordBotGuideHub";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guides.discordBot" });

  return {
    title: t("hub.title"),
    description: t("hub.subtitle"),
  };
}

export default async function DiscordBotGuidePage() {
  const t = await getTranslations("guides.discordBot");

  return (
    <div className="min-w-0">
      <p className="mb-6 text-xs text-hq-fg-muted">
        <Link href="/" className="text-hq-accent hover:underline">
          {t("hub.backToHome")}
        </Link>
      </p>
      <DiscordBotGuideHub />
    </div>
  );
}
