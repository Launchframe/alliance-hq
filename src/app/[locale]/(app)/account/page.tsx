import { getLocale } from "next-intl/server";

import { AccountSettingsForm } from "@/components/AccountSettingsForm";
import { hqUserHasOAuthProvider, loadSignInMethodSnapshot } from "@/lib/auth/account-linking.server";
import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";
import { getAuthSsoAvailability } from "@/lib/auth/sso-config.server";
import {
  getAshedConnectionMeta,
  getSessionStateFor,
  requirePageSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { getAccountTimezoneIdForSession } from "@/lib/timezone/server";
import { getDiscordHqLinkByHqUserId } from "@/lib/vr/repository";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    discordLinked?: string;
    discordLinkError?: string;
    discordUnlinked?: string;
    linked?: string;
    linkError?: string;
  }>;
};

export default async function AccountPage({ searchParams }: Props) {
  const locale = await getLocale();
  const params = await searchParams;
  const session = await requirePageSession("/account");
  const sessionState = await getSessionStateFor(session, locale);
  const ashed = await getAshedConnectionMeta(session.id, locale);
  const timezone = await getAccountTimezoneIdForSession(session.id);
  const hqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  const discordBotLink = hqUserId
    ? await getDiscordHqLinkByHqUserId(hqUserId)
    : null;
  const hasDiscordOAuth = hqUserId
    ? await hqUserHasOAuthProvider(hqUserId, "discord")
    : false;
  const ssoAvailability = getAuthSsoAvailability();
  const signInSnapshot = hqUserId
    ? await loadSignInMethodSnapshot(hqUserId)
    : null;

  const discordLinked = Boolean(discordBotLink || hasDiscordOAuth);
  const linkNotice =
    params.discordLinked === "1"
      ? ("linked" as const)
      : params.discordUnlinked === "1"
        ? ("unlinked" as const)
        : null;

  const signInLinkNotice =
    params.linked === "google" || params.linked === "discord"
      ? (params.linked as LinkedOAuthProvider)
      : null;

  const initialSignInMethods = signInSnapshot
    ? {
        email: signInSnapshot.email,
        hasPassword: signInSnapshot.hasPassword,
        passkeyCount: signInSnapshot.passkeyCount,
        linkedProviders: signInSnapshot.linkedProviders,
        oauthAccounts: signInSnapshot.oauthAccounts,
        availableProviders: {
          google: ssoAvailability.google,
          discord: ssoAvailability.discord,
        },
      }
    : null;

  return (
    <AccountSettingsForm
      initialAshed={ashed}
      initialTimezoneId={timezone}
      discordLinked={discordLinked}
      discordAvailable={ssoAvailability.discord}
      discordLinkNotice={linkNotice}
      discordLinkError={params.discordLinkError?.trim() || null}
      initialSignInMethods={initialSignInMethods}
      signInLinkNotice={signInLinkNotice}
      signInLinkError={params.linkError?.trim() || null}
      ssoAvailability={ssoAvailability}
      isAshedConnectAllowed={sessionState.rbac?.isAshedConnectAllowed ?? false}
    />
  );
}
