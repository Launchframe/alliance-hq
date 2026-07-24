import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { JoinCodeClient } from "@/components/auth/JoinCodeClient";
import { DiscordHqLinkClient } from "@/components/discord/DiscordHqLinkClient";
import { DiscordMemberLinkClient } from "@/components/discord/DiscordMemberLinkClient";
import { auth } from "@/lib/auth";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import { resolveDiscordMemberLinkGate } from "@/lib/auth/discord-member-link-gate.server";
import {
  ensureCurrentAllianceForSession,
  getOrCreateSession,
  loadSession,
} from "@/lib/session";
import { getDiscordMemberLinkPageMeta } from "@/lib/vr/discord-member-link-web.server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DiscordLinkCommanderPage({ searchParams }: PageProps) {
  const t = await getTranslations("discordMemberLink");
  const tAuthorize = await getTranslations("discordAuthorize");
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

  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim() ?? null;

  const gate = await resolveDiscordMemberLinkGate({ nonce, hqUserId });

  if (gate.kind === "invalid_nonce") {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-700/50 bg-hq-surface p-6 text-center">
          <p className="font-semibold text-red-400">{t("expiredHeading")}</p>
          <p className="mt-2 text-sm text-hq-fg-muted">{t("expiredBody")}</p>
        </div>
      </main>
    );
  }

  if (gate.kind === "needs_auth") {
    redirect(`/auth?callbackUrl=${encodeURIComponent(gate.returnPath)}`);
  }

  if (authSession?.user && hqUserId) {
    await bridgeAuthUserToBrowserSession({
      hqUserId,
      email: authSession.user.email ?? "",
      displayName: authSession.user.name,
    });
    const browserSession = (await loadSession((await getOrCreateSession()).id))!;
    await ensureCurrentAllianceForSession(browserSession);
  }

  if (gate.kind === "discord_mismatch") {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-700/50 bg-hq-surface p-6 text-center">
          <p className="font-semibold text-red-400">{t("expiredHeading")}</p>
          <p className="mt-2 text-sm text-hq-fg-muted">{tAuthorize("hqLinkDiscordMismatch")}</p>
        </div>
      </main>
    );
  }

  if (gate.kind === "needs_discord_oauth") {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-hq-border bg-hq-surface p-6">
          <h1 className="mb-1 text-lg font-semibold text-hq-fg">{tAuthorize("userLinkHeading")}</h1>
          <p className="mb-5 text-sm text-hq-fg-muted">{t("discordOAuthSubheading")}</p>
          <DiscordHqLinkClient
            nonce={nonce}
            callbackPath={gate.returnPath}
            labels={{
              continueWithDiscord: tAuthorize("userLinkSubmit"),
            }}
          />
        </div>
      </main>
    );
  }

  if (gate.kind === "needs_join_code") {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-hq-border bg-hq-surface p-6">
          <h1 className="mb-1 text-lg font-semibold text-hq-fg">{t("heading")}</h1>
          <p className="mb-5 text-sm text-hq-fg-muted">{tAuthorize("hqLinkSuccessJoinIntro")}</p>
          <JoinCodeClient
            showBackLink={false}
            showHeader={false}
            embedded
            redirectToOverride={gate.returnPath}
          />
        </div>
      </main>
    );
  }

  const meta = await getDiscordMemberLinkPageMeta(nonce);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-hq-border bg-hq-surface p-6">
        <DiscordMemberLinkClient
          nonce={nonce}
          allianceTag={meta?.allianceTag ?? null}
          replaceAll={meta?.replaceAll ?? false}
          guildRegistered={meta?.guildRegistered ?? false}
          labels={{
            heading: t("heading"),
            subheading: t("subheading"),
            subheadingColdStart: t("subheadingColdStart"),
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
            wrongServerHeading: t("wrongServerHeading"),
            positionNotHomeHeading: t("positionNotHomeHeading"),
            confirmHomeHeading: t("confirmHomeHeading"),
            confirmHomeAllianceChoice: t("confirmHomeAllianceChoice"),
            confirmHomeLookupChoice: t("confirmHomeLookupChoice"),
            guildNotRegisteredHeading: t("guildNotRegisteredHeading"),
            guildNotRegisteredBody: t("guildNotRegisteredBody"),
            backToDiscord: t("backToDiscord"),
            invalidPlayerId: t("invalidPlayerId"),
            genericError: t("genericError"),
          }}
        />
      </div>
    </main>
  );
}
