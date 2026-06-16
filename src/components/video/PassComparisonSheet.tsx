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
};

export function PassComparisonSheet(props: Props) {
  const { comparison, onClose, onSelectJob, onAccuracyVote } = props;
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
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
        <h2 className="font-semibold text-[#e6edf3]">{t("comparisonSheetTitle")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-[#8b949e] hover:text-[#e6edf3]"
        >
          {t("comparisonClose")}
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-2 divide-x divide-[#30363d] border-b border-[#30363d]">
          <div className="bg-[#161b22] px-3 py-2 text-center text-xs text-[#8b949e]">
            {t("comparisonPassHeader", {
              pass: t("comparisonPassA"),
              key: primaryKey,
              count: primaryRows.length,
            })}
          </div>
          <div className="bg-[#161b22] px-3 py-2 text-center text-xs text-[#8b949e]">
            {t("comparisonPassHeader", {
              pass: t("comparisonPassB"),
              key: shadowKey,
              count: shadowRows.length,
            })}
          </div>
        </div>

        {/* Aligned rows */}
        <div className="h-full overflow-y-auto">
          {loadingRows ? (
            <div className="flex items-center justify-center py-12 text-sm text-[#8b949e]">
              Loading…
            </div>
          ) : null}
          <div className="grid grid-cols-2 divide-x divide-[#30363d]">
            {!loadingRows && allKeys.map((key) => {
              const p = primaryByKey.get(key);
              const s = shadowByKey.get(key);
              const onlyInP = p && !s;
              const onlyInS = !p && s;
              return (
                <div key={key} className="contents">
                  <div
                    className={`border-t border-[#30363d] px-3 py-2 text-sm ${onlyInP ? "bg-[#3fb95010]" : ""}`}
                  >
                    {p ? (
                      <>
                        <div className="font-medium">{p.memberName ?? p.ocrName}</div>
                        <div className="font-mono text-xs text-[#8b949e]">{p.score}</div>
                      </>
                    ) : (
                      <div className="text-xs text-[#8b949e]">—</div>
                    )}
                  </div>
                  <div
                    className={`border-t border-[#30363d] px-3 py-2 text-sm ${onlyInS ? "bg-[#3fb95010]" : ""}`}
                  >
                    {s ? (
                      <>
                        <div className="font-medium">{s.memberName ?? s.ocrName}</div>
                        <div className="font-mono text-xs text-[#8b949e]">{s.score}</div>
                      </>
                    ) : (
                      <div className="text-xs text-[#8b949e]">—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="space-y-3 border-t border-[#30363d] px-4 py-4">
        <p className="text-sm text-[#8b949e]">{t("comparisonAccuracyPrompt")}</p>
        <div className="flex flex-wrap gap-3">
          {comparison.passes.map((pass, i) => (
            <button
              key={pass.jobId}
              type="button"
              disabled={!!accuracyVoted}
              onClick={() => handleVote(pass.jobId)}
              className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60 ${
                accuracyVoted === pass.jobId
                  ? "border-[#3fb950] bg-[#3fb95020] text-[#3fb950]"
                  : "border-[#30363d] hover:bg-[#21262d]"
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
            disabled={!!accuracyVoted}
            onClick={() => handleVote("same")}
            className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm hover:bg-[#21262d] disabled:opacity-60"
          >
            {t("comparisonAboutSame")}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {comparison.passes.map((pass, i) => (
            <button
              key={pass.jobId}
              type="button"
              onClick={() => onSelectJob(pass.jobId)}
              className="rounded-lg border border-[#238636] bg-[#238636] px-3 py-1.5 text-sm text-white"
            >
              {i === 0 ? t("comparisonUseA") : t("comparisonUseB")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
