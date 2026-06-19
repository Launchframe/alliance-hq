"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { allianceTrainMinimumsApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import type { TrainMinimumsWindow } from "@/lib/trains/train-conductor-minimums.shared";

export type TrainMinimumsPayload = {
  minVsPoints: number | null;
  minDonationPoints: number | null;
  leewayPct: number;
  window: TrainMinimumsWindow;
  canManage: boolean;
};

type Props = {
  allianceTag: string;
};

export function AllianceTrainMinimumsSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.trainMinimums");
  const [settings, setSettings] = useState<TrainMinimumsPayload | null>(null);
  const [minVs, setMinVs] = useState("");
  const [minDonation, setMinDonation] = useState("");
  const [leewayPct, setLeewayPct] = useState("0");
  const [windowMode, setWindowMode] = useState<TrainMinimumsWindow>("weekly");
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;
  const displaySettings = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceTrainMinimumsApiPath(allianceTag));
        const body = (await res.json()) as TrainMinimumsPayload & {
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
          setSettings(body);
          setMinVs(body.minVsPoints != null ? String(body.minVsPoints) : "");
          setMinDonation(
            body.minDonationPoints != null ? String(body.minDonationPoints) : "",
          );
          setLeewayPct(String(body.leewayPct));
          setWindowMode(body.window);
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

  const parseOptionalMinimum = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const leeway = Number.parseInt(leewayPct, 10);
      const res = await fetch(allianceTrainMinimumsApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minVsPoints: parseOptionalMinimum(minVs),
          minDonationPoints: parseOptionalMinimum(minDonation),
          leewayPct: Number.isFinite(leeway) ? leeway : 0,
          window: windowMode,
        }),
      });
      const body = (await res.json()) as TrainMinimumsPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
      setMinVs(body.minVsPoints != null ? String(body.minVsPoints) : "");
      setMinDonation(
        body.minDonationPoints != null ? String(body.minDonationPoints) : "",
      );
      setLeewayPct(String(body.leewayPct));
      setWindowMode(body.window);
    } catch {
      setError(t("saveFailed"));
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

  if (!displaySettings) {
    return error ? (
      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <p className="text-sm text-[#f85149]">{error}</p>
      </section>
    ) : null;
  }

  return (
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="text-base font-semibold text-[#e6edf3]">{t("sectionTitle")}</h2>
      <p className="mt-1 text-sm text-[#8b949e]">{t("sectionBody")}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-[#8b949e]">{t("minVsLabel")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={minVs}
            onChange={(e) => setMinVs(e.target.value)}
            disabled={!displaySettings.canManage || busy}
            placeholder={t("minimumPlaceholder")}
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-[#e6edf3] disabled:opacity-60"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[#8b949e]">{t("minDonationLabel")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={minDonation}
            onChange={(e) => setMinDonation(e.target.value)}
            disabled={!displaySettings.canManage || busy}
            placeholder={t("minimumPlaceholder")}
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-[#e6edf3] disabled:opacity-60"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[#8b949e]">{t("leewayLabel")}</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={leewayPct}
            onChange={(e) => setLeewayPct(e.target.value)}
            disabled={!displaySettings.canManage || busy}
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-[#e6edf3] disabled:opacity-60"
          />
          <span className="mt-1 block text-xs text-[#8b949e]">{t("leewayHint")}</span>
        </label>
        <fieldset className="text-sm">
          <legend className="text-[#8b949e]">{t("windowLabel")}</legend>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[#e6edf3]">
              <input
                type="radio"
                name="train-minimums-window"
                checked={windowMode === "weekly"}
                onChange={() => setWindowMode("weekly")}
                disabled={!displaySettings.canManage || busy}
              />
              {t("windowWeekly")}
            </label>
            <label className="flex items-center gap-2 text-[#e6edf3]">
              <input
                type="radio"
                name="train-minimums-window"
                checked={windowMode === "daily"}
                onChange={() => setWindowMode("daily")}
                disabled={!displaySettings.canManage || busy}
              />
              {t("windowDaily")}
            </label>
          </div>
          <span className="mt-1 block text-xs text-[#8b949e]">{t("windowHint")}</span>
        </fieldset>
      </div>

      {error ? <p className="mt-3 text-sm text-[#f85149]">{error}</p> : null}

      {displaySettings.canManage ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-60"
          >
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-[#8b949e]">{t("officersOnly")}</p>
      )}
    </section>
  );
}
