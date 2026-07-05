import { getLocale } from "next-intl/server";

import { ConnectFlowClient } from "@/components/ConnectFlowClient";
import {
  parseConnectQueryReturn,
  resolveConnectReturnPath,
} from "@/lib/connect/connect-return-path.shared";
import { shouldSkipConnectWalkthrough, shouldSkipLinkPhoneStep } from "@/lib/connect/walkthrough.server";
import { redirect } from "@/i18n/navigation";
import { requireAuthForPage } from "@/lib/auth/page-guard";
import { rethrowNavigationError } from "@/lib/navigation";
import {
  getAshedConnection,
  getSessionStateFor,
  requirePageSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ welcome?: string; next?: string }>;
};

export default async function ConnectPage({ searchParams }: Props) {
  const locale = await getLocale();
  const { welcome, next } = await searchParams;

  let showWelcomeChoice = false;
  let skipWalkthroughToPaste = false;
  let skipLinkPhoneStep = false;
  let returnTo: string | undefined;

  try {
    await requireAuthForPage("/connect");
    const session = await requirePageSession("/connect");
    const state = await getSessionStateFor(session, locale);
    if (state.rbac && !state.rbac.isAshedConnectAllowed && state.hasAppAccess) {
      redirect({ href: "/dashboard", locale });
    }
    const connected = await getAshedConnection(session.id);
    if (connected) {
      const afterConnect = resolveConnectReturnPath({
        queryNext: next,
        fallback: state.hasAppAccess ? "/members" : "/get-started",
      });
      redirect({ href: afterConnect, locale });
    }
    returnTo = parseConnectQueryReturn(next);
    showWelcomeChoice =
      welcome === "1" && state.hasAppAccess && !state.isConnected;
    skipWalkthroughToPaste = await shouldSkipConnectWalkthrough(session.id);
    skipLinkPhoneStep = await shouldSkipLinkPhoneStep(session.id);
  } catch (error) {
    rethrowNavigationError(error);
    throw error;
  }

  return (
    <ConnectFlowClient
      showWelcomeChoice={showWelcomeChoice}
      skipWalkthroughToPaste={skipWalkthroughToPaste}
      skipLinkPhoneStep={skipLinkPhoneStep}
      returnTo={returnTo}
    />
  );
}
