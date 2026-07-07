import { notFound } from "next/navigation";

import { DiscordBotGuideStepPage } from "@/components/guides/DiscordBotGuideStepPage";
import {
  DISCORD_BOT_GUIDE_ROLE_SLUGS,
  DISCORD_BOT_GUIDE_ROLE_RECOVERY_STEPS,
  DISCORD_BOT_GUIDE_ROLE_STEPS,
  guideStepsForRole,
  isDiscordBotGuideRoleSlug,
  isStepInRole,
} from "@/lib/guides/discord-bot-guide.shared";
import { getTranslations } from "next-intl/server";

type Props = {
  params: Promise<{ locale: string; role: string; step: string }>;
};

export function generateStaticParams() {
  return DISCORD_BOT_GUIDE_ROLE_SLUGS.flatMap((role) =>
    guideStepsForRole(role).map((step) => ({ role, step })),
  );
}

export async function generateMetadata({ params }: Props) {
  const { locale, role, step } = await params;
  if (!isDiscordBotGuideRoleSlug(role) || !isStepInRole(role, step)) {
    return { title: "Guide" };
  }
  const t = await getTranslations({ locale, namespace: "guides.discordBot" });
  const messageKey = step.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return {
    title: t(`steps.${messageKey}.title`),
    description: t(`steps.${messageKey}.summary`),
  };
}

export default async function DiscordBotGuideStepRoute({ params }: Props) {
  const { role, step } = await params;
  if (!isDiscordBotGuideRoleSlug(role) || !isStepInRole(role, step)) {
    notFound();
  }

  return (
    <div className="min-w-0">
      <DiscordBotGuideStepPage role={role} stepSlug={step} />
    </div>
  );
}
