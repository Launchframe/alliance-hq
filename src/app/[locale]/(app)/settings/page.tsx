import { getLocale } from "next-intl/server";

import { SettingsConnectionForm } from "@/components/SettingsConnectionForm";
import {
  getAshedConnectionMeta,
  requirePageSession,
} from "@/lib/session";
import { getAccountTimezoneIdForSession } from "@/lib/timezone/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const locale = await getLocale();
  const session = await requirePageSession("/settings");
  const ashed = await getAshedConnectionMeta(session.id, locale);
  const timezone = await getAccountTimezoneIdForSession(session.id);

  return (
    <SettingsConnectionForm
      initialAshed={ashed}
      initialAllianceId={session.allianceId}
      initialTimezoneId={timezone}
    />
  );
}
