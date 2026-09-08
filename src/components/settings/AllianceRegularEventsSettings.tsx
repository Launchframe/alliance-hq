"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { RegularEventsCalendar } from "@/components/regular-events/RegularEventsCalendar";
import { allianceRegularEventsApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";
import type {
  RegularEventRuleDto,
  RegularEventsGuildLink,
} from "@/lib/regular-events/settings.shared";

type Props = {
  allianceTag: string;
  /** When set, hide global toggles that don't apply and filter the calendar. */
  filterEventKey?: RegularEventKey | null;
  showAnnouncementToggles?: boolean;
};

type Payload = {
  announcementsEnabled: boolean;
  canyonStormActive: boolean;
  guildChannelCount: number;
  r4ChannelCount?: number;
  guilds: RegularEventsGuildLink[];
  rules: RegularEventRuleDto[];
  canManage: boolean;
  error?: string;
  code?: string;
};

function scheduleValidationErrorMessage(
  code: string | undefined,
  fallback: string | undefined,
  t: ReturnType<typeof useTranslations<"settings.regularEvents">>,
): string {
  switch (code) {
    case "adjacent_days":
      return t("validationAdjacent");
    case "min_gap_days":
      return t("validationMinGap");
    case "once_per_week":
      return t("validationOncePerWeek");
    case "wed_fri_only":
      return t("validationWedFri");
    case "alternating_week":
      return t("validationAlternating");
    case "biweekly_phase":
      return t("validationBiweeklyPhase");
    default:
      return fallback ?? t("saveFailed");
  }
}

export function AllianceRegularEventsSettings({
  allianceTag,
  filterEventKey = null,
  showAnnouncementToggles = true,
}: Props) {
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

  const patch = async (payload: Record<string, unknown>) => {
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
        setError(scheduleValidationErrorMessage(body.code, body.error, t));
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

  const showCanyon =
    showAnnouncementToggles || filterEventKey === "zombie_siege";

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5 space-y-4">
      <div>
        <h2 className="font-medium">
          {filterEventKey ? t("scheduleTitle") : t("title")}
        </h2>
        <p className="mt-1 text-sm text-hq-fg-muted">
          {filterEventKey ? t("scheduleHint") : t("description")}
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {showAnnouncementToggles ? (
        <>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={display?.announcementsEnabled ?? false}
              disabled={busy || !display?.canManage}
              onChange={(e) =>
                void patch({ announcementsEnabled: e.target.checked })
              }
            />
            <span>
              <span className="font-medium">{t("enableAnnouncements")}</span>
              <span className="mt-1 block text-hq-fg-muted">
                {display && display.guildChannelCount > 0
                  ? t("channelsConfigured", {
                      count: display.guildChannelCount,
                    })
                  : t("noChannel")}
              </span>
            </span>
          </label>
          <p className="text-sm text-hq-fg-muted">
            <span className="font-medium text-hq-fg">{t("r4ChannelHint")}</span>
            <span className="mt-1 block">
              {display && (display.r4ChannelCount ?? 0) > 0
                ? t("r4ChannelConfigured", {
                    count: display.r4ChannelCount ?? 0,
                  })
                : t("noR4Channel")}
            </span>
          </p>
        </>
      ) : null}

      {showCanyon ? (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={display?.canyonStormActive ?? false}
            disabled={busy || !display?.canManage}
            onChange={(e) =>
              void patch({ canyonStormActive: e.target.checked })
            }
          />
          <span>
            <span className="font-medium">{t("canyonStormLabel")}</span>
            <span className="mt-1 block text-hq-fg-muted">
              {t("canyonStormHint")}
            </span>
          </span>
        </label>
      ) : null}

      {!display?.canManage ? (
        <p className="text-sm text-hq-fg-muted">{t("readOnlyHint")}</p>
      ) : null}

      {display ? (
        <RegularEventsCalendar
          rules={display.rules}
          canManage={display.canManage}
          filterEventKey={filterEventKey}
          busy={busy}
          onUpdateRule={async (input) => {
            await patch({ updateRule: input });
          }}
        />
      ) : null}
    </section>
  );
}
