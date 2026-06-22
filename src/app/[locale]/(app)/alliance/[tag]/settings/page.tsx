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
import { AllianceTrainMinimumsSettings } from "@/components/settings/AllianceTrainMinimumsSettings";
import { AllianceTrainWeekSettings } from "@/components/settings/AllianceTrainWeekSettings";
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
      <AllianceTrainWeekSettings allianceTag={alliance.tag} />
      <AllianceTrainMinimumsSettings allianceTag={alliance.tag} />
    </div>
  );
}
