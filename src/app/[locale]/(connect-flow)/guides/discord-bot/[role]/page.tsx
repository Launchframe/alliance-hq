import { notFound } from "next/navigation";

import { DiscordBotGuideFlowchart } from "@/components/guides/DiscordBotGuideFlowchart";
import { Link } from "@/i18n/navigation";
import {
  DISCORD_BOT_GUIDE_ROLE_SLUGS,
  isDiscordBotGuideRoleSlug,
} from "@/lib/guides/discord-bot-guide.shared";
import { getTranslations } from "next-intl/server";

type Props = {
  params: Promise<{ locale: string; role: string }>;
};

export function generateStaticParams() {
  return DISCORD_BOT_GUIDE_ROLE_SLUGS.map((role) => ({ role }));
}

export async function generateMetadata({ params }: Props) {
  const { locale, role } = await params;
  if (!isDiscordBotGuideRoleSlug(role)) {
    return { title: "Guide" };
  }
  const t = await getTranslations({ locale, namespace: "guides.discordBot" });
  return {
    title: t(`roles.${role}.title`),
    description: t(`roles.${role}.description`),
  };
}

export default async function DiscordBotGuideRolePage({ params }: Props) {
  const { role } = await params;
  if (!isDiscordBotGuideRoleSlug(role)) {
    notFound();
  }

  const t = await getTranslations("guides.discordBot");

  return (
    <div className="min-w-0">
      <p className="mb-6 text-xs text-hq-fg-muted">
        <Link href="/guides/discord-bot" className="text-hq-accent hover:underline">
          {t("hub.title")}
        </Link>
      </p>
      <DiscordBotGuideFlowchart role={role} />
    </div>
  );
}
