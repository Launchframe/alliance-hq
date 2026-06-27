import { getTranslations } from "next-intl/server";

import { DiscordAuthorizeForm } from "@/components/discord/DiscordAuthorizeForm";
import { DiscordHqLinkClient } from "@/components/discord/DiscordHqLinkClient";
import { getValidDiscordAuthNonce } from "@/lib/vr/auth-nonce";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DiscordAuthorizePage({ searchParams }: PageProps) {
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

  const nonceRow = await getValidDiscordAuthNonce(nonce);

  if (!nonceRow) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-700/50 bg-[#161b22] p-6 text-center">
          <p className="font-semibold text-red-400">{t("expiredHeading")}</p>
          <p className="mt-2 text-sm text-[#8b949e]">{t("expiredBody")}</p>
        </div>
      </main>
    );
  }

  const isHqLink = nonceRow.purpose === "user_link";
  const displayTag = isHqLink ? "" : nonceRow.tag.toUpperCase();
  const heading = isHqLink ? t("userLinkHeading") : t("heading");
  const subheading = isHqLink ? t("userLinkSubheading") : t("subheading");

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h1 className="mb-1 text-lg font-semibold text-[#e6edf3]">{heading}</h1>
        <p className="mb-5 text-sm text-[#8b949e]">{subheading}</p>

        {isHqLink ? (
          <DiscordHqLinkClient
            nonce={nonce}
            labels={{
              continueWithDiscord: t("userLinkSubmit"),
            }}
          />
        ) : (
          <DiscordAuthorizeForm
            nonce={nonce}
            tag={displayTag}
            labels={{
              tagLabel: t("tagLabel"),
              keyLabel: t("keyLabel"),
              keyHint: t("keyHint"),
              submit: t("submit"),
              submitting: t("submitting"),
              successHeading: t("successHeading"),
              successBody: t("successBody"),
              errorPrefix: t("errorPrefix"),
            }}
          />
        )}
      </div>
    </main>
  );
}
