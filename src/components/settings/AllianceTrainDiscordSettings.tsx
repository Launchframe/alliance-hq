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
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
      <h2 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h2>
      <p className="mt-1 text-sm text-[#8b949e]">{t("description")}</p>
      <p className="mt-2 text-sm text-[#8b949e]">
        <Link href="/guides/discord-train" className="text-[#58a6ff] hover:underline">
          {t("guideLink")}
        </Link>
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-[#8b949e]">{t("loading")}</p>
      ) : error ? (
        <p className="mt-4 text-sm text-[#f85149]">{error}</p>
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
            <span className="text-sm text-[#e6edf3]">{t("enableAnnouncements")}</span>
          </label>
          <p className="text-sm text-[#8b949e]">
            {display.guildChannelCount > 0
              ? t("channelsConfigured", { count: display.guildChannelCount })
              : t("noChannel")}
          </p>
          {!display.canManage ? (
            <p className="text-xs text-[#8b949e]">{t("readOnlyHint")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
