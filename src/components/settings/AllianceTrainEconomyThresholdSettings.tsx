"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { allianceTrainEconomyThresholdApiPath } from "@/lib/alliance/alliance-settings-path.shared";

export type TrainEconomyThresholdPayload = {
  thresholdPoints: number | null;
  fudgePct: number;
  canManage: boolean;
};

type Props = {
  allianceTag: string;
};

export function AllianceTrainEconomyThresholdSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.trainEconomyThreshold");
  const [settings, setSettings] = useState<TrainEconomyThresholdPayload | null>(
    null,
  );
  const [thresholdPoints, setThresholdPoints] = useState("");
  const [fudgePct, setFudgePct] = useState("1");
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;
  const displaySettings = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceTrainEconomyThresholdApiPath(allianceTag));
        const body = (await res.json()) as TrainEconomyThresholdPayload & {
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
          setThresholdPoints(
            body.thresholdPoints != null ? String(body.thresholdPoints) : "",
          );
          setFudgePct(String(body.fudgePct));
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

  const parseOptionalThreshold = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const fudge = Number.parseInt(fudgePct, 10);
      const res = await fetch(allianceTrainEconomyThresholdApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thresholdPoints: parseOptionalThreshold(thresholdPoints),
          fudgePct: Number.isFinite(fudge) ? fudge : 1,
        }),
      });
      const body = (await res.json()) as TrainEconomyThresholdPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
      setThresholdPoints(
        body.thresholdPoints != null ? String(body.thresholdPoints) : "",
      );
      setFudgePct(String(body.fudgePct));
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
            <span className="text-hq-fg-muted">{t("thresholdLabel")}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={thresholdPoints}
              onChange={(e) => setThresholdPoints(e.target.value)}
              disabled={!displaySettings.canManage || busy}
              placeholder={t("thresholdPlaceholder")}
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="text-hq-fg-muted">{t("fudgeLabel")}</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={fudgePct}
              onChange={(e) => setFudgePct(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              disabled={!displaySettings.canManage || busy}
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
            />
            <span className="mt-1 block text-xs text-hq-fg-muted">{t("fudgeHint")}</span>
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
          <p className="mt-4 text-xs text-hq-fg-muted">{t("officersOnly")}</p>
        )}
      </form>
    </section>
  );
}
