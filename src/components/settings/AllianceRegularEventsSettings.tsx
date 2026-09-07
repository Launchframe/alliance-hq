"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { allianceRegularEventsApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import type {
  RegularEventRuleDto,
  RegularEventsGuildLink,
} from "@/lib/regular-events/settings.shared";

type Props = {
  allianceTag: string;
};

type Payload = {
  announcementsEnabled: boolean;
  canyonStormActive: boolean;
  guildChannelCount: number;
  guilds: RegularEventsGuildLink[];
  rules: RegularEventRuleDto[];
  canManage: boolean;
  error?: string;
};

function summarizeRule(
  rule: RegularEventRuleDto,
  t: ReturnType<typeof useTranslations<"settings.regularEvents">>,
): string {
  if (rule.scheduleKind === "interval_after_last") {
    return t("ruleInterval", {
      days: rule.intervalDays ?? 2,
      time: rule.anchorTimeSt ?? "23:00",
    });
  }
  const slots = rule.weeklySlots ?? [];
  if (slots.length === 0) return t("ruleWeeklyEmpty");
  const dowNames = [
    t("dow.sun"),
    t("dow.mon"),
    t("dow.tue"),
    t("dow.wed"),
    t("dow.thu"),
    t("dow.fri"),
    t("dow.sat"),
  ];
  return slots
    .map((s) => `${dowNames[s.dow] ?? s.dow} ${s.timeSt}`)
    .join(", ");
}

export function AllianceRegularEventsSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.regularEvents");
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
        const res = await fetch(allianceRegularEventsApiPath(allianceTag));
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
    canyonStormActive?: boolean;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceRegularEventsApiPath(allianceTag), {
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

  if (loading) {
    return (
      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5 space-y-4">
      <div>
        <h2 className="font-medium">{t("title")}</h2>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("description")}</p>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={display?.announcementsEnabled ?? false}
          disabled={busy || !display?.canManage}
          onChange={(e) => void patch({ announcementsEnabled: e.target.checked })}
        />
        <span>
          <span className="font-medium">{t("enableAnnouncements")}</span>
          <span className="mt-1 block text-hq-fg-muted">
            {display && display.guildChannelCount > 0
              ? t("channelsConfigured", { count: display.guildChannelCount })
              : t("noChannel")}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={display?.canyonStormActive ?? false}
          disabled={busy || !display?.canManage}
          onChange={(e) => void patch({ canyonStormActive: e.target.checked })}
        />
        <span>
          <span className="font-medium">{t("canyonStormLabel")}</span>
          <span className="mt-1 block text-hq-fg-muted">
            {t("canyonStormHint")}
          </span>
        </span>
      </label>

      {!display?.canManage ? (
        <p className="text-sm text-hq-fg-muted">{t("readOnlyHint")}</p>
      ) : null}

      {display && display.rules.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("scheduleTitle")}</h3>
          <ul className="space-y-2 text-sm">
            {display.rules.map((rule) => (
              <li
                key={rule.id}
                className="rounded-lg border border-hq-border/60 px-3 py-2"
              >
                <div className="font-medium">{rule.eventLabel}</div>
                <div className="text-hq-fg-muted">{summarizeRule(rule, t)}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
