import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DiscordHqLinkCompleteSuccess } from "@/components/discord/DiscordHqLinkCompleteSuccess";
import { DiscordHqLinkExploreSuccess } from "@/components/discord/DiscordHqLinkExploreSuccess";
import { auth } from "@/lib/auth";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import { completeDiscordBotHqLink } from "@/lib/auth/discord-hq-link.server";
import { hqUserNeedsCommanderLink } from "@/lib/member-link/commander-link-gate.server";
import { hqUserHasActiveAllianceMembership } from "@/lib/native-alliance/access";
import {
  DISCORD_POST_LINK_COMMANDER_DESTINATION,
  resolveDiscordPostLinkOnboardingRedirect,
} from "@/lib/navigation/safe-redirect.shared";
import {
  ensureCurrentAllianceForSession,
  getOrCreateSession,
  loadSession,
} from "@/lib/session";

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

  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();

  if (!hqUserId || !authSession?.user) {
    redirect(
      `/auth?callbackUrl=${encodeURIComponent(`/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`)}`,
    );
  }

  const userEmail = authSession.user.email ?? "";
  const userName = authSession.user.name;

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

  await bridgeAuthUserToBrowserSession({
    hqUserId,
    email: userEmail,
    displayName: userName,
  });

  const browserSession = (await loadSession((await getOrCreateSession()).id))!;
  await ensureCurrentAllianceForSession(browserSession);

  const hasAllianceMembership = await hqUserHasActiveAllianceMembership(hqUserId);

  if (!hasAllianceMembership) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <DiscordHqLinkCompleteSuccess
          labels={{
            successHeading: t("successHeading"),
            successBody: t("hqLinkSuccessBody"),
            joinIntro: t("hqLinkSuccessJoinIntro"),
          }}
        />
      </main>
    );
  }

  if (await hqUserNeedsCommanderLink(hqUserId)) {
    redirect(resolveDiscordPostLinkOnboardingRedirect());
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <DiscordHqLinkExploreSuccess
        labels={{
          successHeading: t("successHeading"),
          successBody: t("hqLinkAllSetBody"),
          exploreCta: t("hqLinkExploreCta"),
          exploreDismiss: t("hqLinkExploreDismiss"),
          exploreHref: DISCORD_POST_LINK_COMMANDER_DESTINATION,
        }}
      />
    </main>
  );
}
