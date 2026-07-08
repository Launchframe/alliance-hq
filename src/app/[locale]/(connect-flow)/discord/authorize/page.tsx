import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ConnectionWalkthrough } from "@/components/ConnectionWalkthrough";
import { DiscordHqLinkClient } from "@/components/discord/DiscordHqLinkClient";
import { auth } from "@/lib/auth";
import { hqUserHasOAuthProvider } from "@/lib/auth/account-linking.server";
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
        <div className="w-full max-w-md rounded-xl border border-hq-border bg-hq-surface p-6 text-center">
          <p className="text-sm text-hq-fg-muted">{t("missingNonce")}</p>
        </div>
      </main>
    );
  }

  const nonceRow = await getValidDiscordAuthNonce(nonce);

  if (!nonceRow) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-700/50 bg-hq-surface p-6 text-center">
          <p className="font-semibold text-red-400">{t("expiredHeading")}</p>
          <p className="mt-2 text-sm text-hq-fg-muted">{t("expiredBody")}</p>
        </div>
      </main>
    );
  }

  const isHqLink = nonceRow.purpose === "user_link";

  if (isHqLink) {
    const session = await auth();
    const hqUserId = session?.user?.id?.trim();
    const completePath = `/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`;

    if (!hqUserId) {
      const selfPath = `/discord/authorize?nonce=${encodeURIComponent(nonce)}`;
      redirect(`/auth?callbackUrl=${encodeURIComponent(selfPath)}`);
    }

    if (await hqUserHasOAuthProvider(hqUserId, "discord")) {
      redirect(completePath);
    }
  }

  const displayTag = isHqLink ? "" : nonceRow.tag.toUpperCase();
  const heading = isHqLink ? t("userLinkHeading") : t("heading");
  const subheading = isHqLink ? t("userLinkSubheading") : t("subheading");

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div
        className={
          isHqLink
            ? "w-full max-w-md rounded-xl border border-hq-border bg-hq-surface p-6"
            : "w-full max-w-3xl rounded-xl border border-hq-border bg-hq-surface p-6"
        }
      >
        <h1 className="mb-1 text-lg font-semibold text-hq-fg">{heading}</h1>
        <p className="mb-5 text-sm text-hq-fg-muted">{subheading}</p>

        {isHqLink ? (
          <DiscordHqLinkClient
            nonce={nonce}
            labels={{
              continueWithDiscord: t("userLinkSubmit"),
            }}
          />
        ) : (
          <>
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-[#8b949e]">
              {t("tagLabel")}:{" "}
              <span className="font-mono text-base normal-case text-[#e6edf3]">
                {displayTag}
              </span>
            </p>
            <ConnectionWalkthrough
              skipLinkPhoneStep
              connectApiUrl="/api/discord/authorize"
              connectApiExtraBody={{ nonce }}
            />
          </>
        )}
      </div>
    </main>
  );
}
