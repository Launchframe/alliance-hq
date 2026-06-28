import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { AllianceRouteError } from "@/lib/alliance/alliance-route-context.server";
import {
  listAllianceSettingsTargetsForSession,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { AllianceSeasonSettings } from "@/components/settings/AllianceSeasonSettings";
import { AllianceSettingsSwitcher } from "@/components/settings/AllianceSettingsSwitcher";
import { AllianceDiscordServerSetup } from "@/components/settings/AllianceDiscordServerSetup";
import { AllianceTrainMinimumsSettings } from "@/components/settings/AllianceTrainMinimumsSettings";
import { AllianceTrainDiscordSettings } from "@/components/settings/AllianceTrainDiscordSettings";
import { AllianceTrainWeekSettings } from "@/components/settings/AllianceTrainWeekSettings";
import {
  getDiscordBotInstallUrl,
  isDiscordBotInstallConfigured,
} from "@/lib/discord/bot-install-url.server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { countRegisteredGuildsForAlliance } from "@/lib/vr/repository";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AllianceSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; tag: string }>;
}) {
  const { tag } = await params;
  const session = await requirePageSession(`/alliance/${tag}/settings`);
  const t = await getTranslations("allianceSettings");

  let alliance;
  try {
    alliance = await resolveAllianceRouteForSession(session.id, tag);
  } catch (error) {
    if (error instanceof AllianceRouteError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const membershipAlliances = await listAllianceSettingsTargetsForSession(
    session.id,
  );

  const [installUrl, registeredGuildCount, canManageDiscordSetup] =
    await Promise.all([
      Promise.resolve(getDiscordBotInstallUrl()),
      countRegisteredGuildsForAlliance(alliance.allianceId),
      sessionHasPermissionForAlliance(session.id, alliance.allianceId, "trains:write"),
    ]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-lg space-y-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-[#58a6ff] hover:underline"
        >
          ← {t("backToAccountSettings")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">
          {t("subtitle", {
            alliance: `${alliance.tag} (${alliance.name})`,
          })}
        </p>
      </div>

      <AllianceSettingsSwitcher
        alliances={membershipAlliances}
        activeTag={alliance.tag}
        label={t("switchAlliance")}
      />

      <AllianceSeasonSettings allianceTag={alliance.tag} />
      <AllianceDiscordServerSetup
        allianceTag={alliance.tag}
        installUrl={installUrl}
        installConfigured={isDiscordBotInstallConfigured()}
        registeredGuildCount={registeredGuildCount}
        canManage={canManageDiscordSetup}
      />
      <AllianceTrainWeekSettings allianceTag={alliance.tag} />
      <AllianceTrainDiscordSettings allianceTag={alliance.tag} />
      <AllianceTrainMinimumsSettings allianceTag={alliance.tag} />
    </div>
  );
}
