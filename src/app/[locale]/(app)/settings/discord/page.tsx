import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { AllianceDiscordServerSetup } from "@/components/settings/AllianceDiscordServerSetup";
import { DiscordTrainChannelSetupLinks } from "@/components/settings/DiscordTrainChannelSetupLinks";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { isDiscordBotInstallConfigured } from "@/lib/discord/bot-install-url.server";
import { getDb, schema } from "@/lib/db";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { countRegisteredGuildsForAlliance } from "@/lib/vr/repository";
import { loadTrainDiscordSettings } from "@/lib/trains/train-discord-settings.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsDiscordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/discord");
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return <AllianceContextRequired alliances={access.pickAlliance} />;
  }

  const t = await getTranslations("settings.discord");
  const tSettings = await getTranslations("settings");

  if (access.allianceId === null) {
    redirect({ href: "/settings", locale });
    throw new Error("Alliance context required.");
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      tag: schema.alliances.tag,
      name: schema.alliances.name,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, access.allianceId))
    .limit(1);

  const allianceTag = alliance?.tag ?? access.session.allianceTag;
  if (!allianceTag) {
    redirect({ href: "/settings", locale });
    throw new Error("Alliance tag required.");
  }

  const [registeredGuildCount, canManageDiscordSetup, trainDiscordSettings] =
    await Promise.all([
      countRegisteredGuildsForAlliance(access.allianceId),
      sessionHasPermissionForAlliance(
        access.session.id,
        access.allianceId,
        "trains:write",
      ),
      loadTrainDiscordSettings(access.allianceId, true),
    ]);

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

      <AllianceDiscordServerSetup
        allianceTag={allianceTag}
        installConfigured={isDiscordBotInstallConfigured()}
        registeredGuildCount={registeredGuildCount}
        canManage={canManageDiscordSetup}
      />

      {canManageDiscordSetup ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          <h2 className="font-medium">{t("trainChannelTitle")}</h2>
          <p className="mt-2 text-sm text-hq-fg-muted">{t("trainChannelBody")}</p>
          <div className="mt-4">
            <DiscordTrainChannelSetupLinks
              allianceTag={allianceTag}
              guilds={trainDiscordSettings.guilds}
              registeredGuildCount={registeredGuildCount}
              installConfigured={isDiscordBotInstallConfigured()}
              canManage={canManageDiscordSetup}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
