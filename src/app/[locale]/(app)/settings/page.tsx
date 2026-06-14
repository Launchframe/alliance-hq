import { getLocale } from "next-intl/server";

import { SettingsConnectionForm } from "@/components/SettingsConnectionForm";
import { getAshedConnectionMeta, requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const locale = await getLocale();
  const session = await requirePageSession("/settings");
  const ashed = await getAshedConnectionMeta(session.id, locale);

  return <SettingsConnectionForm initialAshed={ashed} />;
}
