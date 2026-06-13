import { SettingsConnectionForm } from "@/components/SettingsConnectionForm";
import { getAshedConnectionMeta, requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePageSession("/settings");
  const ashed = await getAshedConnectionMeta(session.id);

  return <SettingsConnectionForm initialAshed={ashed} />;
}
