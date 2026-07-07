import { getTranslations } from "next-intl/server";

import { DiscordMemberLinkClient } from "@/components/discord/DiscordMemberLinkClient";
import { getValidDiscordAuthNonce } from "@/lib/vr/auth-nonce";
import { getDiscordMemberLinkPageMeta } from "@/lib/vr/discord-member-link-web.server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DiscordLinkCommanderPage({ searchParams }: PageProps) {
  const t = await getTranslations("discordMemberLink");
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
  if (!nonceRow || nonceRow.purpose !== "member_link") {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-700/50 bg-hq-surface p-6 text-center">
          <p className="font-semibold text-red-400">{t("expiredHeading")}</p>
          <p className="mt-2 text-sm text-hq-fg-muted">{t("expiredBody")}</p>
        </div>
      </main>
    );
  }

  const meta = await getDiscordMemberLinkPageMeta(nonce);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-hq-border bg-hq-surface p-6">
        <h1 className="mb-1 text-lg font-semibold text-hq-fg">{t("heading")}</h1>
        <p className="mb-5 text-sm text-hq-fg-muted">
          {meta?.guildRegistered ? t("subheading") : t("subheadingColdStart")}
        </p>
        <DiscordMemberLinkClient
          nonce={nonce}
          allianceTag={meta?.allianceTag ?? null}
          replaceAll={meta?.replaceAll ?? false}
          labels={{
            playerIdLabel: t("playerIdLabel"),
            playerIdHint: t("playerIdHint"),
            replaceNote: t("replaceNote"),
            continue: t("continue"),
            confirmHeading: t("confirmHeading"),
            confirmServer: t("confirmServer"),
            confirmYes: t("confirmYes"),
            confirmNo: t("confirmNo"),
            fuzzyHeading: t("fuzzyHeading"),
            successHeading: t("successHeading"),
            successBody: t("successBody"),
            officerHeading: t("officerHeading"),
            backToDiscord: t("backToDiscord"),
            invalidPlayerId: t("invalidPlayerId"),
            genericError: t("genericError"),
          }}
        />
      </div>
    </main>
  );
}
