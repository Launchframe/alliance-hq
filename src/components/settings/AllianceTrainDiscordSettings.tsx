"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { allianceTrainDiscordApiPath } from "@/lib/alliance/alliance-settings-path.shared";

type Props = {
  allianceTag: string;
};

type Payload = {
  announcementsEnabled: boolean;
  guildChannelCount: number;
  canManage: boolean;
  error?: string;
};

export function AllianceTrainDiscordSettings({ allianceTag }: Props) {
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

  const toggle = async (next: boolean) => {
    if (!display?.canManage) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceTrainDiscordApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcementsEnabled: next }),
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
          {!display.canManage ? (
            <p className="text-xs text-hq-fg-muted">{t("readOnlyHint")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
