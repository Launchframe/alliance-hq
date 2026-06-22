"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { allianceTrainWeekApiPath } from "@/lib/alliance/alliance-settings-path.shared";

const WEEKDAY_OPTIONS = [
  { value: 0, key: "sun" },
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
] as const;

type Props = {
  allianceTag: string;
};

export function AllianceTrainWeekSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.trainWeek");
  const tWeekdays = useTranslations("trains.weekdays");
  const [trainWeekStartDow, setTrainWeekStartDow] = useState(2);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceTrainWeekApiPath(allianceTag));
        const body = (await res.json()) as {
          trainWeekStartDow?: number;
          canManage?: boolean;
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setError(body.error ?? t("loadFailed"));
            setLoadedTag(allianceTag);
          }
          return;
        }
        if (!cancelled) {
          setTrainWeekStartDow(body.trainWeekStartDow ?? 2);
          setCanManage(body.canManage === true);
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

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceTrainWeekApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainWeekStartDow }),
      });
      const body = (await res.json()) as {
        trainWeekStartDow?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setTrainWeekStartDow(body.trainWeekStartDow ?? trainWeekStartDow);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#30363d] bg-[#161b22] p-6">
      <h2 className="text-lg font-semibold text-[#e6edf3]">{t("sectionTitle")}</h2>
      <p className="mt-1 text-sm text-[#8b949e]">{t("sectionBody")}</p>

      {loading ? (
        <p className="mt-4 text-sm text-[#8b949e]">{t("loading")}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <fieldset className="space-y-2" disabled={!canManage || busy}>
            <legend className="text-sm font-medium text-[#c9d1d9]">
              {t("startDayLabel")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                    trainWeekStartDow === option.value
                      ? "border-[#58a6ff] bg-[#58a6ff]/15 text-[#e6edf3]"
                      : "border-[#30363d] text-[#8b949e]"
                  }`}
                >
                  <input
                    type="radio"
                    name="trainWeekStartDow"
                    value={option.value}
                    checked={trainWeekStartDow === option.value}
                    onChange={() => setTrainWeekStartDow(option.value)}
                    className="sr-only"
                  />
                  {tWeekdays(option.key)}
                </label>
              ))}
            </div>
            <p className="text-xs text-[#8b949e]">{t("startDayHint")}</p>
          </fieldset>

          {!canManage ? (
            <p className="text-xs text-[#8b949e]">{t("adminsOnly")}</p>
          ) : (
            <Button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? t("saving") : t("save")}
            </Button>
          )}

          {error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
