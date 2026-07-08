"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PassComparison } from "@/lib/video/compare-pass-results";

type Pass = {
  id: string;
  passKey: string | null;
  passIndex: number | null;
  passRole: string | null;
  status: string;
  frameCount: number | null;
  parseSessionId: string | null;
};

type ParsedRow = {
  id: string;
  ocrName: string;
  score: string;
  memberId: string | null;
  memberName: string | null;
  deleted: number;
};

type Props = {
  groupId: string;
  comparison: PassComparison;
  passes: Pass[];
  onClose: () => void;
  onSelectJob: (jobId: string) => void;
  onAccuracyVote: (jobId: string) => void;
  groupActionBusy?: string | null;
};

export function PassComparisonSheet(props: Props) {
  const {
    comparison,
    onClose,
    onSelectJob,
    onAccuracyVote,
    groupActionBusy = null,
  } = props;
  const t = useTranslations("videoReview");
  const [primaryRows, setPrimaryRows] = useState<ParsedRow[]>([]);
  const [shadowRows, setShadowRows] = useState<ParsedRow[]>([]);
  const [accuracyVoted, setAccuracyVoted] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(true);

  const primaryPass = comparison.passes[0];
  const shadowPass = comparison.passes[1];

  useEffect(() => {
    let cancelled = false;

    async function loadRows(jobId: string): Promise<ParsedRow[]> {
      const res = await fetch(`/api/tools/video-upload/${jobId}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { rows?: ParsedRow[] };
      return (data.rows ?? []).filter((r) => !r.deleted);
    }

    void Promise.all([
      primaryPass?.jobId ? loadRows(primaryPass.jobId) : Promise.resolve([]),
      shadowPass?.jobId ? loadRows(shadowPass.jobId) : Promise.resolve([]),
    ]).then(([pRows, sRows]) => {
      if (cancelled) return;
      setPrimaryRows(pRows);
      setShadowRows(sRows);
      setLoadingRows(false);
    });

    return () => {
      cancelled = true;
    };
  }, [primaryPass?.jobId, shadowPass?.jobId]);

  function rowKey(r: ParsedRow): string {
    return r.memberId ?? r.ocrName.toLowerCase().trim();
  }

  const allKeys = [
    ...new Set([
      ...primaryRows.map(rowKey),
      ...shadowRows.map(rowKey),
    ]),
  ];

  const primaryByKey = new Map(primaryRows.map((r) => [rowKey(r), r]));
  const shadowByKey = new Map(shadowRows.map((r) => [rowKey(r), r]));

  function handleVote(jobId: string) {
    setAccuracyVoted(jobId);
    onAccuracyVote(jobId);
  }

  const primaryKey = primaryPass?.passKey ?? t("comparisonPrimaryFallback");
  const shadowKey = shadowPass?.passKey ?? t("comparisonShadowFallback");

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-hq-canvas">
      <div className="shrink-0 flex items-center justify-between border-b border-hq-border px-4 py-3">
        <h2 className="font-semibold text-hq-fg">{t("comparisonSheetTitle")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-hq-fg-muted hover:text-hq-fg"
        >
          {t("comparisonClose")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Column headers */}
        <div className="shrink-0 grid grid-cols-2 divide-x divide-hq-border border-b border-hq-border">
          <div className="bg-hq-surface px-3 py-2 text-center text-xs text-hq-fg-muted">
            {t("comparisonPassHeader", {
              pass: t("comparisonPassA"),
              key: primaryKey,
              count: primaryRows.length,
            })}
          </div>
          <div className="bg-hq-surface px-3 py-2 text-center text-xs text-hq-fg-muted">
            {t("comparisonPassHeader", {
              pass: t("comparisonPassB"),
              key: shadowKey,
              count: shadowRows.length,
            })}
          </div>
        </div>

        {/* Aligned rows — flex-1 + min-h-0 so overflow scrolls instead of clipping */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loadingRows ? (
            <div className="flex items-center justify-center py-12 text-sm text-hq-fg-muted">
              {t("comparisonLoadingRows")}
            </div>
          ) : null}
          <div className="grid grid-cols-2 divide-x divide-hq-border pb-6">
            {!loadingRows && allKeys.map((key) => {
              const p = primaryByKey.get(key);
              const s = shadowByKey.get(key);
              const onlyInP = p && !s;
              const onlyInS = !p && s;
              return (
                <div key={key} className="contents">
                  <div
                    className={`border-t border-hq-border px-3 py-2 text-sm ${onlyInP ? "bg-[#3fb95010]" : ""}`}
                  >
                    {p ? (
                      <>
                        <div className="font-medium">{p.memberName ?? p.ocrName}</div>
                        <div className="font-mono text-xs text-hq-fg-muted">{p.score}</div>
                      </>
                    ) : (
                      <div className="text-xs text-hq-fg-muted">—</div>
                    )}
                  </div>
                  <div
                    className={`border-t border-hq-border px-3 py-2 text-sm ${onlyInS ? "bg-[#3fb95010]" : ""}`}
                  >
                    {s ? (
                      <>
                        <div className="font-medium">{s.memberName ?? s.ocrName}</div>
                        <div className="font-mono text-xs text-hq-fg-muted">{s.score}</div>
                      </>
                    ) : (
                      <div className="text-xs text-hq-fg-muted">—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-3 border-t border-hq-border px-4 py-4">
        <p className="text-sm text-hq-fg-muted">{t("comparisonAccuracyPrompt")}</p>
        <div className="flex flex-wrap gap-3">
          {comparison.passes.map((pass, i) => (
            <button
              key={pass.jobId}
              type="button"
              disabled={!!accuracyVoted || !!groupActionBusy}
              onClick={() => handleVote(pass.jobId)}
              className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60 ${
                accuracyVoted === pass.jobId
                  ? "border-hq-green bg-[#3fb95020] text-hq-green"
                  : "border-hq-border hover:bg-hq-surface-muted"
              }`}
            >
              {i === 0 ? t("comparisonPassA") : t("comparisonPassB")} (
              {pass.passKey ??
                (i === 0
                  ? t("comparisonPrimaryFallback")
                  : t("comparisonShadowFallback"))}
              )
            </button>
          ))}
          <button
            type="button"
            disabled={!!accuracyVoted || !!groupActionBusy}
            onClick={() => handleVote("same")}
            className="rounded-lg border border-hq-border px-3 py-1.5 text-sm hover:bg-hq-surface-muted disabled:opacity-60"
          >
            {t("comparisonAboutSame")}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {comparison.passes.map((pass, i) => (
            <button
              key={pass.jobId}
              type="button"
              disabled={!!groupActionBusy}
              onClick={() => onSelectJob(pass.jobId)}
              className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {groupActionBusy === `select:${pass.jobId}`
                ? t("submitting")
                : i === 0
                  ? t("comparisonUseA")
                  : t("comparisonUseB")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
