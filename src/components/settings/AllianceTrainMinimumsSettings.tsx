"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
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
      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (!displaySettings) {
    return error ? (
      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <p className="text-sm text-hq-danger">{error}</p>
      </section>
    ) : null;
  }

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="text-base font-semibold text-hq-fg">{t("sectionTitle")}</h2>
      <p className="mt-1 text-sm text-hq-fg-muted">{t("sectionBody")}</p>

      <form
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void save();
        }}
      >
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-hq-fg-muted">{t("minVsLabel")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={minVs}
            onChange={(e) => setMinVs(e.target.value)}
            disabled={!displaySettings.canManage || busy}
            placeholder={t("minimumPlaceholder")}
            className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
          />
        </label>
        <label className="block text-sm">
          <span className="text-hq-fg-muted">{t("minDonationLabel")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={minDonation}
            onChange={(e) => setMinDonation(e.target.value)}
            disabled={!displaySettings.canManage || busy}
            placeholder={t("minimumPlaceholder")}
            className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
          />
        </label>
        <label className="block text-sm">
          <span className="text-hq-fg-muted">{t("leewayLabel")}</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={leewayPct}
            onChange={(e) => setLeewayPct(e.target.value)}
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            disabled={!displaySettings.canManage || busy}
            className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
          />
          <span className="mt-1 block text-xs text-hq-fg-muted">{t("leewayHint")}</span>
        </label>
        <fieldset className="text-sm">
          <legend className="text-hq-fg-muted">{t("windowLabel")}</legend>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-hq-fg">
              <input
                type="radio"
                name="train-minimums-window"
                checked={windowMode === "weekly"}
                onChange={() => setWindowMode("weekly")}
                disabled={!displaySettings.canManage || busy}
              />
              {t("windowWeekly")}
            </label>
            <label className="flex items-center gap-2 text-hq-fg">
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
          <span className="mt-1 block text-xs text-hq-fg-muted">{t("windowHint")}</span>
        </fieldset>
      </div>

      {error ? <p className="mt-3 text-sm text-hq-danger">{error}</p> : null}

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
