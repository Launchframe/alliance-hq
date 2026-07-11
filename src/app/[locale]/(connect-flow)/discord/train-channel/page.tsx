import { getTranslations } from "next-intl/server";

import { DiscordTrainChannelSetupLinks } from "@/components/settings/DiscordTrainChannelSetupLinks";
import { Link } from "@/i18n/navigation";
import { isDiscordBotInstallConfigured } from "@/lib/discord/bot-install-url.server";
import { countRegisteredGuildsForAlliance } from "@/lib/vr/repository";
import { loadTrainDiscordSettings } from "@/lib/trains/train-discord-settings.server";
import { requirePageSession } from "@/lib/session";
import { resolveAllianceRouteForSession } from "@/lib/alliance/alliance-route-context.server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

export default async function DiscordTrainChannelPage({
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const { tag: tagParam } = await searchParams;
  const session = await requirePageSession("/discord/train-channel");
  const t = await getTranslations("settings.trainDiscord.channelSetup");

  if (!tagParam?.trim()) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <p className="text-sm text-hq-fg-muted">{t("missingTag")}</p>
        <Link href="/settings/trains" className="text-sm text-hq-accent hover:underline">
          {t("backToTrains")}
        </Link>
      </div>
    );
  }

  const alliance = await resolveAllianceRouteForSession(session.id, tagParam.trim());
  const canManage = await sessionHasPermissionForAlliance(
    session.id,
    alliance.allianceId,
    "trains:write",
  );
  const [settings, registeredGuildCount, installConfigured] = await Promise.all([
    loadTrainDiscordSettings(alliance.allianceId, canManage),
    countRegisteredGuildsForAlliance(alliance.allianceId),
    Promise.resolve(isDiscordBotInstallConfigured()),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div>
        <Link href="/settings/trains" className="text-sm text-hq-accent hover:underline">
          ← {t("backToTrains")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-hq-fg">{t("pageTitle")}</h1>
        <p className="mt-2 text-sm text-hq-fg-muted">
          {t("pageBody", { tag: alliance.tag })}
        </p>
      </div>

      <ol className="list-decimal space-y-2 pl-5 text-sm text-hq-fg">
        <li>{t("stepOpenDiscord")}</li>
        <li>{t("stepPickChannel")}</li>
        <li>
          {t("stepRunCommand")}{" "}
          <code className="rounded bg-hq-canvas px-1.5 py-0.5 text-cyan-200">
            /set-train-channel
          </code>
        </li>
        <li>{t("stepEnableAnnouncements")}</li>
      </ol>

      <DiscordTrainChannelSetupLinks
        allianceTag={alliance.tag}
        guilds={settings.guilds}
        registeredGuildCount={registeredGuildCount}
        installConfigured={installConfigured}
        canManage={canManage}
      />

      <Link
        href="/guides/discord-bot/r5/train-channel"
        className="inline-block text-sm text-hq-accent hover:underline"
      >
        {t("guideLink")} →
      </Link>
    </div>
  );
}
