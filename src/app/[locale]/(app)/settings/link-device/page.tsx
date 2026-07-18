import { getLocale } from "next-intl/server";

import { LinkDeviceSettingsClient } from "@/components/credential-pairing/LinkDeviceSettingsClient";
import { redirect } from "@/i18n/navigation";
import {
  getAshedConnection,
  getSessionStateFor,
  requirePageSession,
} from "@/lib/session";
import { rethrowNavigationError } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export default async function LinkDeviceSettingsPage() {
  const locale = await getLocale();
  let isConnected = false;

  try {
    const session = await requirePageSession("/settings/link-device");
    const state = await getSessionStateFor(session, locale);
    if (state.rbac && !state.rbac.isAshedConnectAllowed) {
      redirect({ href: "/account", locale });
    }
    const connection = await getAshedConnection(session.id);
    isConnected = Boolean(connection);
  } catch (error) {
    rethrowNavigationError(error);
    throw error;
  }

  return <LinkDeviceSettingsClient isConnected={isConnected} />;
}
