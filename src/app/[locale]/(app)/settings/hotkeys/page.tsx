import { getLocale } from "next-intl/server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

import { HotkeysSettingsClient } from "@/components/hotkeys/HotkeysSettingsClient";
import { getPageSessionState, requirePageSession } from "@/lib/session";
import { sessionCanReadAllianceVideoQueue } from "@/lib/video/processor-slots.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("hotkeys");
  return await allianceScopedMetadata(t("settingsTitle"));
}
export default async function HotkeysSettingsPage() {
  const locale = await getLocale();
  await requirePageSession("/settings/hotkeys");
  const state = await getPageSessionState("/settings/hotkeys", locale);
  const showVideoQueue =
    state.permissions.includes("hq:video:read") ||
    (await sessionCanReadAllianceVideoQueue(state.sessionId));

  return (
    <HotkeysSettingsClient
      sessionPermissions={state.permissions}
      hasAllianceMemberLink={state.hasAllianceMemberLink}
      isConnected={state.isConnected}
      operatingMode={state.operatingMode}
      showVideoQueue={showVideoQueue}
    />
  );
}
