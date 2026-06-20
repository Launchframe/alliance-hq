import { getLocale } from "next-intl/server";

import { AccountSettingsForm } from "@/components/AccountSettingsForm";
import {
  getAshedConnectionMeta,
  requirePageSession,
} from "@/lib/session";
import { getAccountTimezoneIdForSession } from "@/lib/timezone/server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const locale = await getLocale();
  const session = await requirePageSession("/account");
  const ashed = await getAshedConnectionMeta(session.id, locale);
  const timezone = await getAccountTimezoneIdForSession(session.id);

  return (
    <AccountSettingsForm
      initialAshed={ashed}
      initialTimezoneId={timezone}
    />
  );
}
