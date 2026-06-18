"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export type AllianceSeasonPayload = {
  seasonKey: string;
  source: string;
  isPostSeason: boolean;
  week: number | null;
  gameServerNumber: number | null;
  seasonKeyOverride: string | null;
  canManageSeason: boolean;
};

export function AllianceSeasonSettings() {
  const t = useTranslations("settings.gameSeason");
  const [season, setSeason] = useState<AllianceSeasonPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/alliance/season");
        const body = (await res.json()) as AllianceSeasonPayload & {
          error?: string;
        };
        if (!res.ok) {
          setError(body.error ?? t("loadFailed"));
          return;
        }
        setSeason(body);
        setDraft(body.seasonKeyOverride ?? body.seasonKey);
      } catch {
        setError(t("loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const saveOverride = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/alliance/season", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonKeyOverride: draft.trim() || null }),
      });
      const body = (await res.json()) as AllianceSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSeason(body);
      setDraft(body.seasonKeyOverride ?? body.seasonKey);
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
      const body = (await res.json()) as AllianceSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("clearFailed"));
        return;
      }
      setSeason(body);
      setDraft(body.seasonKey);
    } catch {
      setError(t("clearFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <p className="text-sm text-[#8b949e]">{t("loading")}</p>
      </section>
    );
  }

  if (!season) {
    return error ? (
      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <p className="text-sm text-[#f85149]">{error}</p>
      </section>
    ) : null;
  }

  const sourceLabel =
    season.source === "override"
      ? t("source.override")
      : season.source === "cpt-hedge"
        ? t("source.cpt-hedge")
        : season.source === "age-fallback"
          ? t("source.age-fallback")
          : t("source.default");
  const phaseLine =
    season.isPostSeason && season.week != null
      ? t("postSeasonWeek", { week: season.week })
      : season.week != null
        ? t("inSeasonWeek", { week: season.week })
        : null;

  return (
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="font-medium">{t("sectionTitle")}</h2>
      <p className="mt-2 text-sm text-[#8b949e]">{t("sectionBody")}</p>

      <div className="mt-4 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
          {t("label")}
        </p>
        <p className="text-lg font-semibold text-[#e6edf3]">
          {t("seasonLine", { season: season.seasonKey })}
        </p>
        <p className="text-sm text-[#8b949e]">
          {sourceLabel}
          {season.gameServerNumber != null
            ? ` · ${t("serverLine", { server: season.gameServerNumber })}`
            : null}
        </p>
        {phaseLine ? (
          <p className="text-sm text-[#c9d1d9]">{phaseLine}</p>
        ) : null}
      </div>

      {season.canManageSeason ? (
        <div className="mt-4 flex w-full min-w-0 max-w-md flex-col gap-2">
          <label className="text-xs text-[#8b949e]" htmlFor="settings-season-override">
            {t("overrideLabel")}
          </label>
          <input
            id="settings-season-override"
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
              onClick={() => void saveOverride()}
              className="rounded-lg bg-[#238636] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? t("saving") : t("saveOverride")}
            </button>
            {season.seasonKeyOverride ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearOverride()}
                className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#e6edf3] disabled:opacity-60"
              >
                {t("clearOverride")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-[#f85149]">{error}</p> : null}
    </section>
  );
}
