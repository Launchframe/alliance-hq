"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { DiscordTrainChannelSetupLinks } from "@/components/settings/DiscordTrainChannelSetupLinks";
import { allianceTrainDiscordApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import type { TrainDiscordGuildLink } from "@/lib/trains/train-discord-settings.shared";
import type { TrainChannelSetterMinRank } from "@/lib/trains/train-channel-setter.shared";

type Props = {
  allianceTag: string;
  installConfigured: boolean;
};

type Payload = {
  announcementsEnabled: boolean;
  channelSetterMinRank: TrainChannelSetterMinRank;
  guildChannelCount: number;
  guilds: TrainDiscordGuildLink[];
  canManage: boolean;
  canConfigureChannelSetterMinRank: boolean;
  error?: string;
};

export function AllianceTrainDiscordSettings({
  allianceTag,
  installConfigured,
}: Props) {
  const t = useTranslations("settings.trainDiscord");
  const [settings, setSettings] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;
  const display = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceTrainDiscordApiPath(allianceTag));
        const body = (await res.json()) as Payload;
        if (!res.ok) {
          if (!cancelled) {
            setError(body.error ?? t("loadFailed"));
            setLoadedTag(allianceTag);
          }
          return;
        }
        if (!cancelled) {
          setSettings(body);
          setError(null);
          setLoadedTag(allianceTag);
        }
      } catch {
        if (!cancelled) {
          setError(t("loadFailed"));
          setLoadedTag(allianceTag);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allianceTag, t]);

  const patch = async (payload: {
    announcementsEnabled?: boolean;
    channelSetterMinRank?: TrainChannelSetterMinRank;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceTrainDiscordApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as Payload;
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (next: boolean) => {
    if (!display?.canManage) return;
    await patch({ announcementsEnabled: next });
  };

  const setChannelSetterMinRank = async (next: TrainChannelSetterMinRank) => {
    if (!display?.canConfigureChannelSetterMinRank) return;
    await patch({ channelSetterMinRank: next });
  };

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
      <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
      <p className="mt-1 text-sm text-hq-fg-muted">{t("description")}</p>
      <p className="mt-2 text-sm text-hq-fg-muted">
        <Link href="/guides/discord-train" className="text-hq-accent hover:underline">
          {t("guideLink")}
        </Link>
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("loading")}</p>
      ) : error ? (
        <p className="mt-4 text-sm text-hq-danger">{error}</p>
      ) : display ? (
        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={display.announcementsEnabled}
              disabled={!display.canManage || busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            <span className="text-sm text-hq-fg">{t("enableAnnouncements")}</span>
          </label>
          <p className="text-sm text-hq-fg-muted">
            {display.guildChannelCount > 0
              ? t("channelsConfigured", { count: display.guildChannelCount })
              : t("noChannel")}
          </p>
          <DiscordTrainChannelSetupLinks
            allianceTag={allianceTag}
            guilds={display.guilds}
            registeredGuildCount={display.guilds.length}
            installConfigured={installConfigured}
            canManage={display.canManage}
          />
          {display.canConfigureChannelSetterMinRank ? (
            <fieldset
              className="space-y-3 border-t border-hq-border pt-4"
              disabled={busy}
            >
              <legend className="text-sm font-medium text-hq-fg">
                {t("channelSetterTitle")}
              </legend>
              <p className="text-sm text-hq-fg-muted">
                {t("channelSetterDescription")}
              </p>
              <label className="flex items-start gap-3 text-sm text-hq-fg">
                <input
                  type="radio"
                  name="channelSetterMinRank"
                  className="mt-1"
                  checked={display.channelSetterMinRank === "officer"}
                  onChange={() => void setChannelSetterMinRank("officer")}
                />
                <span>
                  <span className="font-medium">{t("channelSetterOfficerLabel")}</span>
                  <span className="mt-1 block text-hq-fg-muted">
                    {t("channelSetterOfficerHint")}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm text-hq-fg">
                <input
                  type="radio"
                  name="channelSetterMinRank"
                  className="mt-1"
                  checked={display.channelSetterMinRank === "owner"}
                  onChange={() => void setChannelSetterMinRank("owner")}
                />
                <span>
                  <span className="font-medium">{t("channelSetterOwnerLabel")}</span>
                  <span className="mt-1 block text-hq-fg-muted">
                    {t("channelSetterOwnerHint")}
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}
          {!display.canManage ? (
            <p className="text-xs text-hq-fg-muted">{t("readOnlyHint")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
