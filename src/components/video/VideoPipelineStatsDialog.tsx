"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import {
  buildPipelineStatsSections,
  formatPipelineDuration,
  frameSkipRatePercent,
  listPipelinePhaseBars,
  ocrOverlapPercent,
  ocrSummedExtractMs,
  ocrSummedUploadMs,
  ocrWallMs,
  shouldShowExtractionQualitySection,
} from "@/lib/video/pipeline-stats-display";
import type { PassComparison } from "@/lib/video/compare-pass-results";

type Props = {
  timings: VideoProcessTimings | null;
  fileName?: string | null;
  comparisonJson?: PassComparison | null;
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "—";
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VideoPipelineStatsButton({ timings, fileName, comparisonJson }: Props) {
  const t = useTranslations("videoReview.statsNerds");
  const [open, setOpen] = useState(false);

  const phaseBars = useMemo(
    () => (timings ? listPipelinePhaseBars(timings.phases) : []),
    [timings],
  );
  const maxPhaseMs = phaseBars[0]?.[1] ?? 1;
  const sections = useMemo(
    () => (timings ? buildPipelineStatsSections(timings) : []),
    [timings],
  );

  const ocrWall = timings ? ocrWallMs(timings.phases) : 0;
  const ocrUploadSum = timings ? ocrSummedUploadMs(timings.phases) : 0;
  const ocrExtractSum = timings ? ocrSummedExtractMs(timings.phases) : 0;
  const showExtractionQuality = timings
    ? shouldShowExtractionQualitySection(timings)
    : false;
  const frameSkipRate = timings
    ? frameSkipRatePercent(timings.framesSkipped, timings.denseFrameCount)
    : null;
  const ocrOverlap = timings?.totalRawOcrRows != null && timings.rowCount != null
    ? ocrOverlapPercent(timings.totalRawOcrRows, timings.rowCount)
    : null;
  const showOcrParallelNote =
    timings != null &&
    ocrWall > 0 &&
    ocrUploadSum + ocrExtractSum > ocrWall * 1.2;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-xs text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff]"
      >
        {t("button")}
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("title")}
        className="max-w-2xl"
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h2>
            {fileName ? (
              <p className="mt-1 truncate text-xs text-[#8b949e]">{fileName}</p>
            ) : null}
          </div>

          {!timings ? (
            <p className="text-sm text-[#8b949e]">{t("empty")}</p>
          ) : (
            <>
              <section className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
                  {t("outcomesTitle")}
                </h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[#8b949e]">{t("fileSize")}</dt>
                    <dd>{formatBytes(timings.fileSizeBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#8b949e]">{t("frames")}</dt>
                    <dd>{timings.frameCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[#8b949e]">{t("rows")}</dt>
                    <dd>{timings.rowCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[#8b949e]">{t("matched")}</dt>
                    <dd>{timings.matchedCount}</dd>
                  </div>
                  {timings.ocrConcurrency > 0 ? (
                    <div>
                      <dt className="text-[#8b949e]">{t("ocrConcurrency")}</dt>
                      <dd>{timings.ocrConcurrency}</dd>
                    </div>
                  ) : null}
                  {timings.ocrFrameAvgMs != null ? (
                    <div>
                      <dt className="text-[#8b949e]">{t("ocrFrameAvg")}</dt>
                      <dd>{formatPipelineDuration(timings.ocrFrameAvgMs)}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {showExtractionQuality ? (
                <section className="min-w-0 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
                    {t("extractionTitle")}
                  </h3>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    {timings.videoDurationSeconds != null ? (
                      <>
                        <dt className="text-[#8b949e]">{t("videoDuration")}</dt>
                        <dd className="font-mono">
                          {timings.videoDurationSeconds.toFixed(1)}s
                        </dd>
                      </>
                    ) : null}
                    {timings.frameCount != null ? (
                      <>
                        <dt className="text-[#8b949e]">{t("framesSelected")}</dt>
                        <dd className="font-mono">{timings.frameCount}</dd>
                      </>
                    ) : null}
                    {timings.denseFrameCount != null ? (
                      <>
                        <dt className="text-[#8b949e]">{t("framesBaseline")}</dt>
                        <dd className="font-mono">{timings.denseFrameCount}</dd>
                      </>
                    ) : null}
                    {timings.framesSkipped != null ? (
                      <>
                        <dt className="text-[#8b949e]">{t("framesSkipped")}</dt>
                        <dd className="font-mono">
                          {timings.framesSkipped}
                          {frameSkipRate != null
                            ? ` ${t("frameSkipRate", { rate: frameSkipRate })}`
                            : ""}
                        </dd>
                      </>
                    ) : null}
                    {timings.totalRawOcrRows != null &&
                    timings.rowCount != null ? (
                      <>
                        <dt className="text-[#8b949e]">{t("ocrOverlap")}</dt>
                        <dd className="font-mono">
                          {t("ocrOverlapSummary", {
                            raw: timings.totalRawOcrRows,
                            unique: timings.rowCount,
                            overlap:
                              ocrOverlap != null
                                ? t("ocrOverlapRate", { rate: ocrOverlap })
                                : "",
                          })}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
                  {t("timelineTitle")}
                </h3>
                <ul className="mt-2 space-y-2 font-mono text-sm">
                  {sections.map((section) =>
                    section.wallMs > 0 ? (
                      <li
                        key={section.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[#21262d] pb-2 last:border-0"
                      >
                        <span className="text-[#e6edf3]">
                          {t(`section.${section.id}`)}
                        </span>
                        <span className="shrink-0 text-[#58a6ff]">
                          {formatPipelineDuration(section.wallMs)}
                        </span>
                      </li>
                    ) : null,
                  )}
                  <li className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-[#30363d] pt-2 font-semibold">
                    <span className="text-[#e6edf3]">{t("total")}</span>
                    <span className="text-[#3fb950]">
                      {formatPipelineDuration(timings.totalMs)}
                    </span>
                  </li>
                </ul>
              </section>

              {showOcrParallelNote ? (
                <p className="text-xs text-[#8b949e]">
                  {t("ocrParallelNote", {
                    wall: formatPipelineDuration(ocrWall),
                    uploadSum: formatPipelineDuration(ocrUploadSum),
                    extractSum: formatPipelineDuration(ocrExtractSum),
                  })}
                </p>
              ) : null}

              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
                  {t("allPhasesTitle")}
                </h3>
                <ul className="mt-2 space-y-2">
                  {phaseBars.map(([phase, ms]) => (
                    <li key={phase}>
                      <div className="mb-1 flex justify-between gap-2 text-xs text-[#8b949e]">
                        <span className="truncate font-mono">{phase}</span>
                        <span className="shrink-0">
                          {formatPipelineDuration(ms)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-[#21262d]">
                        <div
                          className="h-full rounded bg-[#58a6ff]"
                          style={{
                            width: `${Math.max(2, (ms / maxPhaseMs) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {comparisonJson ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8b949e]">
                {t("passComparisonTitle")}
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {comparisonJson.passes.map((pass) => (
                  <div key={pass.jobId} className="rounded-lg border border-[#30363d] p-3">
                    <p className="text-xs font-medium text-[#8b949e]">
                      {pass.passKey ?? pass.passRole ?? "—"}
                    </p>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-[#8b949e]">{t("passRows")}</dt>
                        <dd className="font-mono">{pass.rowCount}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[#8b949e]">{t("passMatched")}</dt>
                        <dd className="font-mono">{pass.matchedCount}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[#8b949e]">{t("passFrames")}</dt>
                        <dd className="font-mono">{pass.frameCount ?? "—"}</dd>
                      </div>
                      {pass.totalMs != null ? (
                        <div className="flex justify-between">
                          <dt className="text-[#8b949e]">{t("passTime")}</dt>
                          <dd className="font-mono">{(pass.totalMs / 1000).toFixed(1)}s</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-[#8b949e]">
                {t("passOverlap", {
                  overlap: comparisonJson.overlapCount,
                  onlyA: comparisonJson.onlyInPrimary,
                  onlyB: comparisonJson.onlyInShadow,
                })}
              </div>
            </section>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
            >
              {t("close")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
