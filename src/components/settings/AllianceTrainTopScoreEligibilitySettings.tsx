"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { allianceTrainTopScoreEligibilityApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import type { TrainTopScoreMinimumRank } from "@/lib/trains/train-top-score-eligibility.shared";

export type TrainTopScoreEligibilityPayload = {
  trainTopScoreMinRank: TrainTopScoreMinimumRank;
  trainTopScoreIncludesR4Plus: boolean;
  canManage: boolean;
};

type Props = {
  allianceTag: string;
};

export function AllianceTrainTopScoreEligibilitySettings({
  allianceTag,
}: Props) {
  const t = useTranslations("settings.trainTopScoreEligibility");
  const [settings, setSettings] =
    useState<TrainTopScoreEligibilityPayload | null>(null);
  const [minRank, setMinRank] = useState<TrainTopScoreMinimumRank>(3);
  const [includesR4Plus, setIncludesR4Plus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;
  const displaySettings = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          allianceTrainTopScoreEligibilityApiPath(allianceTag),
        );
        const body = (await res.json()) as TrainTopScoreEligibilityPayload & {
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setSettings(null);
            setError(body.error ?? t("loadFailed"));
            setLoadedTag(allianceTag);
          }
          return;
        }
        if (!cancelled) {
          setSettings(body);
          setMinRank(body.trainTopScoreMinRank);
          setIncludesR4Plus(body.trainTopScoreIncludesR4Plus);
          setError(null);
          setLoadedTag(allianceTag);
        }
      } catch {
        if (!cancelled) {
          setSettings(null);
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
      const res = await fetch(
        allianceTrainTopScoreEligibilityApiPath(allianceTag),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trainTopScoreMinRank: minRank,
            trainTopScoreIncludesR4Plus: includesR4Plus,
          }),
        },
      );
      const body = (await res.json()) as TrainTopScoreEligibilityPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
      setMinRank(body.trainTopScoreMinRank);
      setIncludesR4Plus(body.trainTopScoreIncludesR4Plus);
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

  if (!displaySettings) {
    return error ? (
      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <p role="alert" className="text-sm text-hq-danger">
          {error}
        </p>
      </section>
    ) : null;
  }

  const minRankShadedPct = ((minRank - 1) / 2) * 100;

  return (
    <section
      data-testid="train-top-score-eligibility-settings"
      className="rounded-xl border border-hq-border bg-hq-surface p-5"
    >
      <h2 className="text-base font-semibold text-hq-fg">{t("sectionTitle")}</h2>
      <p className="mt-1 text-sm text-hq-fg-muted">{t("sectionBody")}</p>

      <form
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void save();
        }}
      >
        <label
          htmlFor="train-top-score-min-rank"
          className="mt-4 block text-sm text-hq-fg-muted"
        >
          {t("minimumRankLabel")}
        </label>
        <input
          id="train-top-score-min-rank"
          data-testid="train-top-score-min-rank"
          type="range"
          min={1}
          max={3}
          step={1}
          value={minRank}
          onChange={(e) =>
            setMinRank(Number(e.target.value) as TrainTopScoreMinimumRank)
          }
          disabled={!displaySettings.canManage || busy}
          className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full disabled:opacity-60 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-hq-accent [&::-webkit-slider-thumb]:border-0 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-hq-accent"
          style={{
            background: `linear-gradient(to right, var(--hq-border) ${minRankShadedPct}%, var(--hq-accent) ${minRankShadedPct}%)`,
          }}
        />
        <div className="mt-1 flex justify-between text-xs text-hq-fg-muted">
          <span>{t("rankR1")}</span>
          <span>{t("rankR2")}</span>
          <span>{t("rankR3")}</span>
        </div>
        <p className="mt-1 text-xs text-hq-fg-muted">
          {t(`minimumRankHintR${minRank}`)}
        </p>

        <label className="mt-4 flex items-center gap-2 text-sm text-hq-fg">
          <input
            type="checkbox"
            checked={includesR4Plus}
            onChange={(e) => setIncludesR4Plus(e.target.checked)}
            disabled={!displaySettings.canManage || busy}
          />
          {t("includeR4PlusLabel")}
        </label>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-hq-danger">
            {error}
          </p>
        ) : null}

        {displaySettings.canManage ? (
          <div className="mt-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-60"
            >
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-xs text-hq-fg-muted">{t("officersOnly")}</p>
        )}
      </form>
    </section>
  );
}
