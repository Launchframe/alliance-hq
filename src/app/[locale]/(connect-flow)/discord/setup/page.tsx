import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DiscordSetupWizard } from "@/components/discord/DiscordSetupWizard";
import { auth } from "@/lib/auth";
import {
  getDiscordProviderAccountIdForHqUser,
  syncDiscordHqLinkFromOAuthSignIn,
} from "@/lib/auth/discord-hq-link.server";
import { isDiscordBotInstallConfigured } from "@/lib/discord/bot-install-url.server";
import { getDiscordHqLinkByHqUserId } from "@/lib/vr/repository";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata() {
  const t = await getTranslations("discordSetup");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function DiscordSetupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();

  if (!hqUserId) {
    const callbackUrl = "/discord/setup";
    const tagParam =
      typeof params.tag === "string" && params.tag.trim()
        ? `?tag=${encodeURIComponent(params.tag.trim())}`
        : "";
    redirect(`/auth?callbackUrl=${encodeURIComponent(`${callbackUrl}${tagParam}`)}`);
  }

  const discordAccountId = await getDiscordProviderAccountIdForHqUser(hqUserId);
  let hqLink = await getDiscordHqLinkByHqUserId(hqUserId);

  if (discordAccountId && !hqLink) {
    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: discordAccountId,
      hqUserId,
    });
    hqLink = await getDiscordHqLinkByHqUserId(hqUserId);
  }

  const tagFromQuery =
    typeof params.tag === "string" ? params.tag.trim().toLowerCase() : "";

  return (
    <main className="min-h-[60vh] p-6">
      <DiscordSetupWizard
        initialTag={tagFromQuery}
        hasDiscordLink={hqLink != null}
        installConfigured={isDiscordBotInstallConfigured()}
      />
    </main>
  );
}
