"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { allianceTrainTopScoreEligibilityApiPath } from "@/lib/alliance/alliance-settings-path.shared";

export type TrainTopScoreEligibilityPayload = {
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
