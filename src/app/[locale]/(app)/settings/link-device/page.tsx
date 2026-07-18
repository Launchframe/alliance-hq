import { getLocale } from "next-intl/server";

import { LinkDeviceSettingsClient } from "@/components/credential-pairing/LinkDeviceSettingsClient";
import { getAshedConnection, requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LinkDeviceSettingsPage() {
  await getLocale();
  const session = await requirePageSession("/settings/link-device");
  const connection = await getAshedConnection(session.id);

  return <LinkDeviceSettingsClient isConnected={Boolean(connection)} />;
}
