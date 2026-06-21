import { getLocale } from "next-intl/server";

import { ConnectFlowClient } from "@/components/ConnectFlowClient";
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
  searchParams: Promise<{ welcome?: string }>;
};

export default async function ConnectPage({ searchParams }: Props) {
  const locale = await getLocale();
  const { welcome } = await searchParams;

  let showWelcomeChoice = false;
  let skipWalkthroughToPaste = false;
  let skipLinkPhoneStep = false;

  try {
    await requireAuthForPage("/connect");
    const session = await requirePageSession("/connect");
    const state = await getSessionStateFor(session, locale);
    if (state.rbac && !state.rbac.isAshedConnectAllowed && state.hasAppAccess) {
      redirect({ href: "/", locale });
    }
    const connected = await getAshedConnection(session.id);
    if (connected) {
      if (state.hasAppAccess) {
        redirect({ href: "/", locale });
      }
      redirect({ href: "/get-started", locale });
    }
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
    />
  );
}
