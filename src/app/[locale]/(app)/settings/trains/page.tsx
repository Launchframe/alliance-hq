import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { AllianceTrainDiscordSettings } from "@/components/settings/AllianceTrainDiscordSettings";
import { AllianceTrainEconomyThresholdSettings } from "@/components/settings/AllianceTrainEconomyThresholdSettings";
import { AllianceTrainMinimumsSettings } from "@/components/settings/AllianceTrainMinimumsSettings";
import { AllianceTrainWeekSettings } from "@/components/settings/AllianceTrainWeekSettings";
import { AllianceVrSandboxSettings } from "@/components/settings/AllianceVrSandboxSettings";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { getDb, schema } from "@/lib/db";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsTrainsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/trains");
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return <AllianceContextRequired alliances={access.pickAlliance} />;
  }

  const t = await getTranslations("settings.trains");
  const tSettings = await getTranslations("settings");

  if (access.allianceId === null) {
    redirect({ href: "/settings", locale });
    throw new Error("Alliance context required.");
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, access.allianceId))
    .limit(1);

  const allianceTag = alliance?.tag ?? access.session.allianceTag;
  if (!allianceTag) {
    redirect({ href: "/settings", locale });
    throw new Error("Alliance tag required.");
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-lg space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-hq-accent hover:underline">
          ← {tSettings("backToAllianceSettings")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">
          {t("subtitle", { tag: allianceTag })}
        </p>
      </div>

      <AllianceTrainWeekSettings allianceTag={allianceTag} />
      <AllianceTrainDiscordSettings allianceTag={allianceTag} />
      <AllianceTrainMinimumsSettings allianceTag={allianceTag} />
      <AllianceTrainEconomyThresholdSettings allianceTag={allianceTag} />
      <AllianceVrSandboxSettings allianceTag={allianceTag} />
    </div>
  );
}
