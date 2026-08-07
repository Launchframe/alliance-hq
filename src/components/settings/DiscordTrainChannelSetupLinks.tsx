"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import type { TrainDiscordGuildLink } from "@/lib/trains/train-discord-settings.shared";

type Props = {
  allianceTag: string;
  guilds: TrainDiscordGuildLink[];
  registeredGuildCount: number;
  installConfigured: boolean;
  canManage: boolean;
  busy?: boolean;
  revokingGuildId?: string | null;
  onRevokeChannel?: (guildId: string) => void;
};

function guildDisplayName(
  guild: TrainDiscordGuildLink,
  fallbackLabel: (id: string) => string,
): string {
  return guild.guildName?.trim() || fallbackLabel(guild.guildId.slice(-6));
}

export function DiscordTrainChannelSetupLinks({
  allianceTag,
  guilds,
  registeredGuildCount,
  installConfigured,
  canManage,
  busy = false,
  revokingGuildId = null,
  onRevokeChannel,
}: Props) {
  const t = useTranslations("settings.trainDiscord.channelSetup");
  const [pendingRevokeGuildId, setPendingRevokeGuildId] = useState<string | null>(
    null,
  );

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
          {guilds.map((guild) => {
            const name = guildDisplayName(guild, (id) =>
              t("guildLabel", { id }),
            );
            const channelDetail =
              guild.hasTrainChannel && guild.trainChannelName
                ? t("channelReadyNamed", {
                    channel: `#${guild.trainChannelName}`,
                  })
                : guild.hasTrainChannel
                  ? t("channelReady")
                  : t("channelMissing");
            const revoking = revokingGuildId === guild.guildId;
            const pendingRevoke = pendingRevokeGuildId === guild.guildId;

            return (
              <li
                key={guild.guildId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hq-border/70 bg-hq-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-hq-fg">
                    {name}
                  </p>
                  <p className="text-xs text-hq-fg-muted">{channelDetail}</p>
                  {pendingRevoke ? (
                    <p className="mt-2 text-xs text-hq-fg">
                      {t("revokeChannelConfirm", { guild: name })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {guild.hasTrainChannel && onRevokeChannel ? (
                    pendingRevoke ? (
                      <>
                        <button
                          type="button"
                          className="rounded-md border border-hq-border px-3 py-1.5 text-xs font-medium text-hq-fg-muted hover:text-hq-fg disabled:opacity-50"
                          disabled={busy || revoking}
                          onClick={() => setPendingRevokeGuildId(null)}
                        >
                          {t("revokeChannelCancel")}
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-hq-danger bg-hq-danger/10 px-3 py-1.5 text-xs font-medium text-hq-danger hover:bg-hq-danger/20 disabled:opacity-50"
                          disabled={busy || revoking}
                          onClick={() => {
                            setPendingRevokeGuildId(null);
                            onRevokeChannel(guild.guildId);
                          }}
                        >
                          {revoking ? t("revokingChannel") : t("revokeChannelConfirmAction")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md border border-hq-border px-3 py-1.5 text-xs font-medium text-hq-fg-muted hover:border-hq-danger hover:text-hq-danger disabled:opacity-50"
                        disabled={busy || revoking}
                        aria-label={t("revokeChannelAria", { guild: name })}
                        onClick={() => setPendingRevokeGuildId(guild.guildId)}
                      >
                        {t("revokeChannel")}
                      </button>
                    )
                  ) : null}
                  <a
                    href={guild.discordOpenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-hq-discord bg-hq-discord/10 px-3 py-1.5 text-xs font-medium text-hq-discord hover:bg-hq-discord/20"
                  >
                    {t("openDiscord")}
                  </a>
                </div>
              </li>
            );
          })}
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
