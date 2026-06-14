import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { ConnectionWalkthrough } from "@/components/ConnectionWalkthrough";
import { rethrowNavigationError } from "@/lib/navigation";
import { getAshedConnection, requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const locale = await getLocale();

  try {
    const session = await requirePageSession("/connect");
    const connected = await getAshedConnection(session.id);
    if (connected) {
      redirect({ href: "/", locale });
    }
  } catch (error) {
    rethrowNavigationError(error);
  }

  return <ConnectionWalkthrough />;
}
