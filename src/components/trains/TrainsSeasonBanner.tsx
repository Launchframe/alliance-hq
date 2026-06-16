"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { TrainsSeasonPayload } from "@/lib/trains/load-dashboard";

type Props = {
  season: TrainsSeasonPayload;
  onUpdated: (season: TrainsSeasonPayload) => void;
};

export function TrainsSeasonBanner({ season, onUpdated }: Props) {
  const t = useTranslations("trains.season");
  const [draft, setDraft] = useState(season.seasonKeyOverride ?? season.seasonKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceLabel = t(`source.${season.source}`);

  const saveOverride = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/alliance/season", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonKeyOverride: draft.trim() || null }),
      });
      const body = (await res.json()) as TrainsSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      onUpdated(body);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const clearOverride = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/alliance/season", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonKeyOverride: null }),
      });
      const body = (await res.json()) as TrainsSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("clearFailed"));
        return;
      }
      setDraft(body.seasonKey);
      onUpdated(body);
    } catch {
      setError(t("clearFailed"));
    } finally {
      setBusy(false);
    }
  };

  const phaseLine =
    season.isPostSeason && season.week != null
      ? t("postSeasonWeek", { week: season.week })
      : season.week != null
        ? t("inSeasonWeek", { week: season.week })
        : null;

  return (
    <section className="rounded-2xl border border-[#30363d] bg-[#161b22] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
            {t("label")}
          </p>
          <p className="mt-1 text-lg font-semibold text-[#e6edf3]">
            {t("seasonLine", { season: season.seasonKey })}
          </p>
          <p className="mt-1 text-sm text-[#8b949e]">
            {sourceLabel}
            {season.gameServerNumber != null
              ? ` · ${t("serverLine", { server: season.gameServerNumber })}`
              : null}
          </p>
          {phaseLine ? (
            <p className="mt-1 text-sm text-[#c9d1d9]">{phaseLine}</p>
          ) : null}
        </div>

        {season.canManageSeason ? (
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:min-w-[14rem]">
            <label className="text-xs text-[#8b949e]" htmlFor="season-override">
              {t("overrideLabel")}
            </label>
            <input
              id="season-override"
              type="text"
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3]"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={saveOverride}
                className="rounded-lg bg-[#238636] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? t("saving") : t("saveOverride")}
              </button>
              {season.seasonKeyOverride ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={clearOverride}
                  className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#e6edf3] disabled:opacity-60"
                >
                  {t("clearOverride")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-[#f85149]">{error}</p> : null}
    </section>
  );
}
