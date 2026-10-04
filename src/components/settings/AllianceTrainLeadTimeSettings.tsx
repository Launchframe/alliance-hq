"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { allianceTrainLeadTimeApiPath } from "@/lib/alliance/alliance-settings-path.shared";

type Props = {
  allianceTag: string;
};

export function AllianceTrainLeadTimeSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.trains.leadTime");
  const [leadDays, setLeadDays] = useState(0);
  const [confirmationEnabled, setConfirmationEnabled] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showApplyTemplateHint, setShowApplyTemplateHint] = useState(false);
  const loading = loadedTag !== allianceTag;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceTrainLeadTimeApiPath(allianceTag));
        const body = (await res.json()) as {
          trainConductorLeadTimeDays?: number;
          trainConductorConfirmationEnabled?: boolean;
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
          setLeadDays(body.trainConductorLeadTimeDays ?? 0);
          setConfirmationEnabled(
            body.trainConductorConfirmationEnabled === true,
          );
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
      const previousDays = leadDays;
      const res = await fetch(allianceTrainLeadTimeApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainConductorLeadTimeDays: leadDays,
          trainConductorConfirmationEnabled: confirmationEnabled,
        }),
      });
      const body = (await res.json()) as {
        trainConductorLeadTimeDays?: number;
        trainConductorConfirmationEnabled?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      const nextDays = body.trainConductorLeadTimeDays ?? leadDays;
      setLeadDays(nextDays);
      setConfirmationEnabled(
        body.trainConductorConfirmationEnabled ?? confirmationEnabled,
      );
      if (previousDays === 0 && nextDays >= 1) {
        setShowApplyTemplateHint(true);
      }
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="lead-time"
      className="scroll-mt-24 rounded-2xl border border-hq-border bg-hq-surface p-6"
    >
      <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
      <p className="mt-1 text-sm text-hq-fg-muted">{t("description")}</p>

      {loading ? (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("loading")}</p>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void save();
          }}
        >
          <fieldset className="space-y-2" disabled={!canManage || busy}>
            <label className="block text-sm font-medium text-hq-fg">
              {t("daysLabel", { count: leadDays })}
            </label>
            <input
              type="number"
              min={0}
              max={7}
              value={leadDays}
              onChange={(e) =>
                setLeadDays(
                  Math.max(0, Math.min(7, Number(e.target.value) || 0)),
                )
              }
              className="w-24 rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-sm text-hq-fg"
            />
          </fieldset>

          <label className="flex items-start gap-2 text-sm text-hq-fg">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmationEnabled}
              disabled={!canManage || busy}
              onChange={(e) => setConfirmationEnabled(e.target.checked)}
            />
            <span>{t("confirmationToggle")}</span>
          </label>

          {showApplyTemplateHint ? (
            <p className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-sm text-hq-fg">
              {t("applyTemplateCta")}
            </p>
          ) : null}

          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          {!canManage ? (
            <p className="text-sm text-hq-fg-muted">{t("adminsOnly")}</p>
          ) : null}

          <Button type="submit" disabled={!canManage || busy}>
            {busy ? t("saving") : t("save")}
          </Button>
        </form>
      )}
    </section>
  );
}
