import { getLocale } from "next-intl/server";
import { standalonePageMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { syncDiscordHqLinkFromSignedInUser } from "@/lib/auth/discord-hq-link.server";
import { redirect } from "@/i18n/navigation";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("metadata");
  return standalonePageMetadata(t("pages.discordHqLinkComplete"));
}
type Props = {
  searchParams: Promise<{ return?: string }>;
};

/** Completes Discord bot-link sync after OAuth from Account settings (no bot nonce). */
export default async function DiscordHqLinkCompletePage({ searchParams }: Props) {
  const locale = await getLocale();
  const { return: returnPath } = await searchParams;
  const destination = sanitizeInternalRedirectPath(returnPath) ?? "/account";

  const session = await auth();
  if (!session?.user?.id?.trim()) {
    redirect({
      href: `/auth?callbackUrl=${encodeURIComponent(`/discord/hq-link/complete?return=${encodeURIComponent(destination)}`)}`,
      locale,
    });
    return null;
  }
  const hqUserId = session.user.id.trim();

  const result = await syncDiscordHqLinkFromSignedInUser(hqUserId);
  const query =
    result.ok === true
      ? "?discordLinked=1"
      : result.reason === "no_discord_oauth"
        ? "?discordLinkError=no_oauth"
        : "?discordLinkError=failed";

  redirect({ href: `${destination}${query}`, locale });
}
