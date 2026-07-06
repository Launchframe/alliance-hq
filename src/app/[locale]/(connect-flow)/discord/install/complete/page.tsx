import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { processDiscordInstallComplete } from "@/lib/vr/process-discord-install-complete.server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata() {
  const t = await getTranslations("discordSetup.installComplete");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function DiscordInstallCompletePage({
  searchParams,
}: PageProps) {
  const t = await getTranslations("discordSetup.installComplete");
  const params = await searchParams;
  const guildId =
    (typeof params.guild_id === "string" ? params.guild_id : null) ??
    (typeof params.guildId === "string" ? params.guildId : null);
  const state =
    typeof params.state === "string" ? params.state.trim() : "";

  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();

  if (!hqUserId) {
    const returnPath = `/discord/install/complete?${new URLSearchParams({
      ...(guildId ? { guild_id: guildId } : {}),
      ...(state ? { state } : {}),
    }).toString()}`;
    redirect(`/auth?callbackUrl=${encodeURIComponent(returnPath)}`);
  }

  if (!guildId || !state) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6 text-center">
          <p className="text-sm text-[#8b949e]">{t("missingParams")}</p>
          <Link
            href="/discord/setup"
            className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
          >
            {t("backToWizard")}
          </Link>
        </div>
      </main>
    );
  }

  const result = await processDiscordInstallComplete({
    guildId,
    stateNonce: state,
    hqUserId,
  });

  if (!result.ok) {
    const errorKey =
      result.reason === "expired_session"
        ? "expiredSession"
        : result.reason === "session_user_mismatch"
          ? "sessionMismatch"
          : result.reason === "missing_alliance"
            ? "missingAlliance"
            : result.reason === "not_owner"
              ? "notOwner"
              : result.reason === "no_credentials"
                ? "noCredentials"
                : "genericError";

    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-700/50 bg-[#161b22] p-6 text-center">
          <p className="font-semibold text-red-400">{t("errorHeading")}</p>
          <p className="mt-2 text-sm text-[#8b949e]">{t(errorKey)}</p>
          <Link
            href="/discord/setup"
            className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
          >
            {t("backToWizard")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-green-700/50 bg-[#161b22] p-6 text-center">
        <p className="text-lg font-semibold text-green-300">{t("successHeading")}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-[#8b949e]">
          {t("successBody", { tag: result.tag.toUpperCase() })}
        </p>
        <Link
          href="/guides/discord-bot/r5/link-self"
          className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {t("nextGuideLink")}
        </Link>
      </div>
    </main>
  );
}
