"use client";

import { useCallback, useMemo, useState } from "react";
import { Syringe } from "lucide-react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { VrProgressProjectionChart } from "@/components/vr/vr-progress-projection-chart";
import { Link } from "@/i18n/navigation";
import type {
  ViralResistanceOfficerPayload,
  ViralResistancePayload,
} from "@/lib/vr/load-leaderboard";
import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";
import { coerceInstituteLevelFromBaseVr } from "@/lib/vr/validation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type Props = {
  initial: ViralResistancePayload;
  officer: ViralResistanceOfficerPayload | null;
  showMyVrCta?: boolean;
};

export function ViralResistanceView({
  initial,
  officer: initialOfficer,
  showMyVrCta = false,
}: Props) {
  const t = useTranslations("viralResistance");
  const [data, setData] = useState(initial);
  const [officer, setOfficer] = useState(initialOfficer);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideMemberId, setOverrideMemberId] = useState("");
  const [overrideVr, setOverrideVr] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideMessage, setOverrideMessage] = useState<string | null>(null);

  const memberOptions = useMemo(
    () =>
      buildMemberMatchSelectOptions(officer?.members ?? [], {
        emptyLabel: t("officer.memberPlaceholder"),
        highlightMemberId: overrideMemberId || null,
      }),
    [officer?.members, overrideMemberId, t],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [leaderRes, officerRes] = await Promise.all([
        fetch("/api/vr/leaderboard"),
        officer ? fetch("/api/vr/officer") : Promise.resolve(null),
      ]);
      const leaderBody = (await leaderRes.json()) as ViralResistancePayload & {
        error?: string;
      };
      if (!leaderRes.ok) {
        setError(leaderBody.error ?? t("loadFailed"));
        return;
      }
      setData(leaderBody);

      if (officerRes) {
        if (officerRes.ok) {
          setOfficer((await officerRes.json()) as ViralResistanceOfficerPayload);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [officer, t]);

  const submitOverride = async () => {
    const instituteLevel = Number.parseInt(overrideVr, 10);
    if (!overrideMemberId.trim() || !Number.isFinite(instituteLevel)) {
      setOverrideMessage(t("officer.invalid"));
      return;
    }
    setOverrideBusy(true);
    setOverrideMessage(null);
    try {
      const res = await fetch("/api/vr/officer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ashedMemberId: overrideMemberId.trim(),
          instituteLevel,
          reason: overrideReason.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setOverrideMessage(body.error ?? t("officer.saveFailed"));
        return;
      }
      setOverrideMessage(t("officer.saved"));
      setOverrideMemberId("");
      setOverrideVr("");
      setOverrideReason("");
      await refresh();
    } catch (e) {
      setOverrideMessage(e instanceof Error ? e.message : t("officer.saveFailed"));
    } finally {
      setOverrideBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
            <p className="mt-2 text-sm text-hq-fg-muted">{t("subtitle")}</p>
            {data.seasonKey ? (
              <p className="mt-1 text-xs text-hq-fg-muted">
                {t("seasonLine", { season: data.seasonKey })}
              </p>
            ) : null}
          </div>
          {showMyVrCta ? (
            <Link
              href="/my-vr"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-hq-accent bg-hq-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 sm:self-start"
            >
              <Syringe className="h-4 w-4 shrink-0" aria-hidden />
              {t("openMyVrCta")}
            </Link>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="mt-3 rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:text-hq-fg disabled:opacity-50"
        >
          {refreshing ? t("refreshing") : t("refresh")}
        </button>
      </header>

      {!error && (data.progressChart?.series.length ?? 0) > 0 ? (
        <div className="rounded-2xl border border-hq-border bg-hq-surface p-4">
          <VrProgressProjectionChart
            series={data.progressChart.series}
            seasonKey={data.progressChart.seasonKey}
            vrUpdatesLocked={data.progressChart.vrUpdatesLocked}
            ariaLabel={t("chart.ariaLabel")}
          />
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-hq-danger">{error}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-hq-border bg-hq-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-hq-border text-xs uppercase tracking-wide text-hq-fg-muted">
              <tr>
                <th className="px-4 py-3">{t("colRank")}</th>
                <th className="px-4 py-3">{t("colMember")}</th>
                <th className="px-4 py-3">{t("colLevel")}</th>
                <th className="px-4 py-3">{t("colVr")}</th>
                <th className="px-4 py-3">{t("colThp")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr
                  key={row.ashedMemberId}
                  className="border-b border-hq-surface-muted last:border-0"
                >
                  <td className="px-4 py-3 text-hq-fg-muted">{index + 1}</td>
                  <td className="px-4 py-3 font-medium text-hq-fg">
                    {row.memberName}
                    {row.flagged ? (
                      <span className="ml-2 text-xs text-hq-warning">
                        {t("flagged")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-hq-fg-muted">
                    {row.instituteLevel}
                  </td>
                  <td className="px-4 py-3 font-mono text-hq-fg">
                    {row.highestBaseVr.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-hq-fg-muted">
                    {row.totalHeroPower.toLocaleString()}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-hq-fg-muted"
                  >
                    {t("empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {officer ? (
        <section className="rounded-2xl border border-hq-border bg-hq-surface p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("officer.title")}
          </h2>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("officer.subtitle")}</p>

          {officer.flagged.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {officer.flagged.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-hq-warning/30 bg-hq-warning/10 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-hq-fg">
                    {officer.members.find((m) => m.id === row.ashedMemberId)
                      ?.current_name ?? row.ashedMemberId}
                  </span>
                  <span className="mx-2 text-hq-fg-muted">·</span>
                  <span className="font-mono">{row.highestBaseVr}</span>
                  <span className="mx-2 text-hq-fg-muted">·</span>
                  <span className="text-hq-fg-muted">
                    {t("officer.levelLine", {
                      level:
                        row.instituteLevel ??
                        coerceInstituteLevelFromBaseVr(
                          officer.seasonKey,
                          row.highestBaseVr,
                        ),
                    })}
                  </span>
                  {row.flagReason ? (
                    <span className="mt-1 block text-xs text-hq-warning">
                      {row.flagReason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-hq-fg-muted">{t("officer.noFlags")}</p>
          )}

          <form
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void submitOverride();
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-hq-fg-muted">
              {t("officer.member")}
              <AppSelect
                value={overrideMemberId}
                onChange={setOverrideMemberId}
                options={memberOptions}
                searchable
                placeholder={t("officer.memberPlaceholder")}
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs text-hq-fg-muted sm:w-36">
              {t("officer.baseVr")}
              <input
                value={overrideVr}
                onChange={(e) => setOverrideVr(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-sm text-hq-fg"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-hq-fg-muted">
              {t("officer.reason")}
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                className="rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-sm text-hq-fg"
              />
            </label>
            <button
              type="submit"
              disabled={overrideBusy}
              className="w-full rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
            >
              {overrideBusy ? t("officer.saving") : t("officer.save")}
            </button>
          </form>
          {overrideMessage ? (
            <p className="mt-3 text-sm text-hq-fg-muted">{overrideMessage}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
