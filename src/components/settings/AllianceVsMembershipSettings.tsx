"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { allianceVsMembershipMinimumsApiPath } from "@/lib/alliance/alliance-settings-path.shared";

export type VsMembershipMinimumsPayload = {
  minPoints: number | null;
  missStrikesBeforeKick: number;
  leewayPct: number;
  canManage: boolean;
};

type Props = {
  allianceTag: string;
};

/**
 * Alliance VS membership requirements — separate from train conductor
 * minimums. Officers still demote/kick in-game; this only drives the
 * informational weekly compliance officer task (Mark complete / Waive).
 */
export function AllianceVsMembershipSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.vsMembershipMinimums");
  const [settings, setSettings] = useState<VsMembershipMinimumsPayload | null>(
    null,
  );
  const [minPoints, setMinPoints] = useState("");
  const [strikesBeforeKick, setStrikesBeforeKick] = useState("3");
  const [leewayPct, setLeewayPct] = useState("0");
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;
  const displaySettings = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceVsMembershipMinimumsApiPath(allianceTag));
        const body = (await res.json()) as VsMembershipMinimumsPayload & {
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
          setMinPoints(body.minPoints != null ? String(body.minPoints) : "");
          setStrikesBeforeKick(String(body.missStrikesBeforeKick));
          setLeewayPct(String(body.leewayPct));
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

  const parseOptionalMinPoints = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const strikes = Number.parseInt(strikesBeforeKick, 10);
      const leeway = Number.parseInt(leewayPct, 10);
      const res = await fetch(allianceVsMembershipMinimumsApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minPoints: parseOptionalMinPoints(minPoints),
          missStrikesBeforeKick: Number.isFinite(strikes) && strikes > 0 ? strikes : 3,
          leewayPct: Number.isFinite(leeway) ? leeway : 0,
        }),
      });
      const body = (await res.json()) as VsMembershipMinimumsPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
      setMinPoints(body.minPoints != null ? String(body.minPoints) : "");
      setStrikesBeforeKick(String(body.missStrikesBeforeKick));
      setLeewayPct(String(body.leewayPct));
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
            <span className="text-hq-fg-muted">{t("minPointsLabel")}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={minPoints}
              onChange={(e) => setMinPoints(e.target.value)}
              disabled={!displaySettings.canManage || busy}
              placeholder={t("minPointsPlaceholder")}
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
            />
            <span className="mt-1 block text-xs text-hq-fg-muted">
              {t("minPointsHint")}
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-hq-fg-muted">{t("strikesLabel")}</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={strikesBeforeKick}
              onChange={(e) => setStrikesBeforeKick(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              disabled={!displaySettings.canManage || busy}
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
            />
            <span className="mt-1 block text-xs text-hq-fg-muted">
              {t("strikesHint")}
            </span>
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
            <span className="mt-1 block text-xs text-hq-fg-muted">
              {t("leewayHint")}
            </span>
          </label>
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
          <p className="mt-4 text-xs text-hq-fg-muted">{t("ownersOnly")}</p>
        )}
      </form>
    </section>
  );
}
