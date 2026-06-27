"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import type {
  ViralResistanceOfficerPayload,
  ViralResistancePayload,
} from "@/lib/vr/load-leaderboard";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type Props = {
  initial: ViralResistancePayload;
  officer: ViralResistanceOfficerPayload | null;
};

export function ViralResistanceView({ initial, officer: initialOfficer }: Props) {
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
    const baseVr = Number.parseInt(overrideVr, 10);
    if (!overrideMemberId.trim() || !Number.isFinite(baseVr)) {
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
          baseVr,
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
        <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
        <p className="mt-2 text-sm text-[#8b949e]">{t("subtitle")}</p>
        {data.seasonKey ? (
          <p className="mt-1 text-xs text-[#8b949e]">
            {t("seasonLine", { season: data.seasonKey })}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="mt-3 rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-50"
        >
          {refreshing ? t("refreshing") : t("refresh")}
        </button>
      </header>

      {error ? (
        <p className="text-sm text-[#f85149]">{error}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#30363d] bg-[#0D0D0D]">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[#30363d] text-xs uppercase tracking-wide text-[#8b949e]">
              <tr>
                <th className="px-4 py-3">{t("colRank")}</th>
                <th className="px-4 py-3">{t("colMember")}</th>
                <th className="px-4 py-3">{t("colVr")}</th>
                <th className="px-4 py-3">{t("colThp")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr
                  key={row.ashedMemberId}
                  className="border-b border-[#21262d] last:border-0"
                >
                  <td className="px-4 py-3 text-[#8b949e]">{index + 1}</td>
                  <td className="px-4 py-3 font-medium text-[#e6edf3]">
                    {row.memberName}
                    {row.flagged ? (
                      <span className="ml-2 text-xs text-[#d29922]">
                        {t("flagged")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-[#e6edf3]">
                    {row.highestBaseVr.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-[#8b949e]">
                    {row.totalHeroPower.toLocaleString()}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-[#8b949e]"
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
        <section className="rounded-2xl border border-[#30363d] bg-[#0D0D0D] p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-[#e6edf3]">
            {t("officer.title")}
          </h2>
          <p className="mt-1 text-sm text-[#8b949e]">{t("officer.subtitle")}</p>

          {officer.flagged.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {officer.flagged.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-[#d2992233] bg-[#d2992211] px-3 py-2 text-sm"
                >
                  <span className="font-mono text-[#e6edf3]">
                    {row.ashedMemberId}
                  </span>
                  <span className="mx-2 text-[#8b949e]">·</span>
                  <span className="font-mono">{row.highestBaseVr}</span>
                  {row.flagReason ? (
                    <span className="mt-1 block text-xs text-[#d29922]">
                      {row.flagReason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[#8b949e]">{t("officer.noFlags")}</p>
          )}

          <form
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void submitOverride();
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[#8b949e]">
              {t("officer.memberId")}
              <input
                value={overrideMemberId}
                onChange={(e) => setOverrideMemberId(e.target.value)}
                className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs text-[#8b949e] sm:w-36">
              {t("officer.baseVr")}
              <input
                value={overrideVr}
                onChange={(e) => setOverrideVr(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[#8b949e]">
              {t("officer.reason")}
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
              />
            </label>
            <button
              type="submit"
              disabled={overrideBusy}
              className="w-full rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
            >
              {overrideBusy ? t("officer.saving") : t("officer.save")}
            </button>
          </form>
          {overrideMessage ? (
            <p className="mt-3 text-sm text-[#8b949e]">{overrideMessage}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
