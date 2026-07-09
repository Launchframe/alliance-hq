"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import type { TrainDiscordGuildLink } from "@/lib/trains/train-discord-settings.shared";

type Props = {
  allianceTag: string;
  guilds: TrainDiscordGuildLink[];
  registeredGuildCount: number;
  installConfigured: boolean;
  canManage: boolean;
};

export function DiscordTrainChannelSetupLinks({
  allianceTag,
  guilds,
  registeredGuildCount,
  installConfigured,
  canManage,
}: Props) {
  const t = useTranslations("settings.trainDiscord.channelSetup");

  if (!canManage) return null;

  return (
    <div className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-3">
      <p className="text-sm font-medium text-hq-fg">{t("title")}</p>
      <p className="mt-1 text-sm text-hq-fg-muted">{t("body")}</p>

      {registeredGuildCount === 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-hq-fg-muted">{t("noGuild")}</p>
          {installConfigured ? (
            <Link
              href={`/discord/setup?tag=${encodeURIComponent(allianceTag)}`}
              className="inline-flex text-sm font-medium text-hq-accent hover:underline"
            >
              {t("installBot")}
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {guilds.map((guild) => (
            <li
              key={guild.guildId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hq-border/70 bg-hq-surface px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-hq-fg">
                  {t("guildLabel", { id: guild.guildId.slice(-6) })}
                </p>
                <p className="text-xs text-hq-fg-muted">
                  {guild.hasTrainChannel ? t("channelReady") : t("channelMissing")}
                </p>
              </div>
              <a
                href={guild.discordOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-md border border-hq-discord bg-hq-discord/10 px-3 py-1.5 text-xs font-medium text-hq-discord hover:bg-hq-discord/20"
              >
                {t("openDiscord")}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link
          href={`/discord/train-channel?tag=${encodeURIComponent(allianceTag)}`}
          className="font-medium text-hq-accent hover:underline"
        >
          {t("setupFlow")}
        </Link>
        <Link
          href="/guides/discord-bot/r5/train-channel"
          className="text-hq-fg-muted hover:text-hq-accent hover:underline"
        >
          {t("guideLink")}
        </Link>
      </div>

      <p className="mt-3 rounded-md bg-hq-surface px-3 py-2 font-mono text-xs text-cyan-200">
        /set-train-channel
      </p>
    </div>
  );
}
