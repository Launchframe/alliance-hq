"use client";

import { useTranslations } from "next-intl";

import {
  compareVsVideoTotals,
  type VsVideoDraftForm,
  type VsVideoEvidenceResponse,
} from "@/lib/vs-performance/video-evidence.shared";
import { vsVideoScreenshotOwnTotal } from "@/lib/vs-performance/video-evidence-review.shared";
import { vsPerformanceDayNumberForDate } from "@/lib/video/vs-recorded-date.shared";

const STATE_CLASSES: Record<string, string> = {
  match: "text-hq-success",
  fine: "text-hq-success",
  warning: "text-hq-warning",
  danger: "text-hq-danger",
  incomplete: "text-hq-fg-muted",
  unavailable: "text-hq-fg-muted",
};

const valueCls = "py-1 text-right tabular-nums text-hq-fg";
const labelCls = "py-1 pr-4 text-hq-fg";

export function VsVideoTotalsComparison(props: {
  state: VsVideoEvidenceResponse | null;
  form: VsVideoDraftForm | null;
  locale: string;
  scores: readonly unknown[];
  complete: boolean;
  contextMatches: boolean;
}) {
  const t = useTranslations("vsPerformance.videoEvidence");
  const { state, form, locale, scores, complete, contextMatches } = props;
  const own = vsVideoScreenshotOwnTotal(state, form, locale);
  if (!own.visible || !contextMatches) return null;

  const comparison = compareVsVideoTotals(own.total, scores, complete);
  const formatTotal = (value: string | null) =>
    value === null ? "—" : new Intl.NumberFormat(locale).format(BigInt(value));
  const allianceTag = state?.alliance.tag ?? state?.alliance.name ?? "";
  const day = state
    ? (vsPerformanceDayNumberForDate(state.evidence.recordedDate) ?? "")
    : "";

  let statusKey: string | null = null;
  if (comparison.state === "match") statusKey = "totalsMatch";
  else if (comparison.state === "fine") statusKey = "differenceFine";
  else if (comparison.state === "warning") statusKey = "differenceWarning";
  else if (comparison.state === "danger") {
    statusKey =
      comparison.screenshotTotal === "0"
        ? "zeroReference"
        : comparison.direction === "excess"
          ? "differenceDangerExcess"
          : "differenceDanger";
  } else if (comparison.state === "incomplete") {
    statusKey = "comparisonIncomplete";
  } else {
    statusKey = "totalUnavailable";
  }

  return (
    <div
      className="rounded-xl border border-hq-border bg-hq-surface p-4"
      data-testid="vs-video-comparison"
      data-state={comparison.state}
    >
      <table className="w-full text-sm">
        <caption className="text-left text-xs font-medium text-hq-fg">
          {t("comparisonTitle", { allianceTag, day })}
        </caption>
        <thead>
          <tr className="text-left text-xs text-hq-fg-muted">
            <th scope="col" className="py-1 pr-4 font-medium">
              {t("sourceColumn")}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t("totalColumn")}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={labelCls}>{t("screenshotTotal")}</td>
            <td className={valueCls}>
              {own.total === null ? (
                <span>
                  —{" "}
                  <span className="text-xs text-hq-fg-muted">
                    {t("totalUnavailable")}
                  </span>
                </span>
              ) : (
                formatTotal(comparison.screenshotTotal ?? own.total)
              )}
            </td>
          </tr>
          <tr>
            <td className={labelCls}>{t("videoTotal")}</td>
            <td className={valueCls}>{formatTotal(comparison.videoTotal)}</td>
          </tr>
          <tr>
            <td className={labelCls}>{t("meanError")}</td>
            <td className={valueCls}>
              {comparison.percentFloor === null
                ? "—"
                : `${new Intl.NumberFormat(locale).format(BigInt(comparison.percentFloor))}%`}
            </td>
          </tr>
        </tbody>
      </table>
      <p
        className={`mt-2 text-xs ${STATE_CLASSES[comparison.state] ?? "text-hq-fg-muted"}`}
        role="status"
      >
        {t(statusKey)}
      </p>
      <p className="mt-1 text-xs text-hq-fg-muted">{t("comparisonHint")}</p>
    </div>
  );
}
