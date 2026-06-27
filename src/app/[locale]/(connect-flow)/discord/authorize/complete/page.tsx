import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { completeDiscordBotHqLink } from "@/lib/auth/discord-hq-link.server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DiscordAuthorizeCompletePage({
  searchParams,
}: PageProps) {
  const t = await getTranslations("discordAuthorize");
  const params = await searchParams;
  const nonce = typeof params.nonce === "string" ? params.nonce.trim() : "";

  if (!nonce) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6 text-center">
          <p className="text-sm text-[#8b949e]">{t("missingNonce")}</p>
        </div>
      </main>
    );
  }

  const session = await auth();
  const hqUserId = session?.user?.id?.trim();

  if (!hqUserId) {
    redirect(
      `/auth?callbackUrl=${encodeURIComponent(`/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`)}`,
    );
  }

  const result = await completeDiscordBotHqLink({ nonce, hqUserId });

  if (!result.ok) {
    const errorKey =
      result.reason === "discord_mismatch"
        ? "hqLinkDiscordMismatch"
        : result.reason === "no_discord_oauth"
          ? "hqLinkNoDiscordOAuth"
          : result.reason === "wrong_purpose"
            ? "hqLinkWrongPurpose"
            : "expiredBody";

    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-700/50 bg-[#161b22] p-6 text-center">
          <p className="font-semibold text-red-400">{t("expiredHeading")}</p>
          <p className="mt-2 text-sm text-[#8b949e]">{t(errorKey)}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-green-700 bg-green-950/40 p-6 text-center">
        <p className="text-lg font-semibold text-green-300">{t("successHeading")}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-green-200">
          {t("hqLinkSuccessBody")}
        </p>
      </div>
    </main>
  );
}
