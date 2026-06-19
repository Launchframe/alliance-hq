import { getLocale } from "next-intl/server";

import { ConnectFlowClient } from "@/components/ConnectFlowClient";
import { redirect } from "@/i18n/navigation";
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

  try {
    const session = await requirePageSession("/connect");
    const connected = await getAshedConnection(session.id);
    if (connected) {
      redirect({ href: "/", locale });
    }

    const state = await getSessionStateFor(session, locale);
    showWelcomeChoice =
      welcome === "1" && state.hasAppAccess && !state.isConnected;
  } catch (error) {
    rethrowNavigationError(error);
    throw error;
  }

  return <ConnectFlowClient showWelcomeChoice={showWelcomeChoice} />;
}
