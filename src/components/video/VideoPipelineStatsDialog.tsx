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
  onOpenComparison?: () => void;
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

export function VideoPipelineStatsButton({
  timings,
  fileName,
  comparisonJson,
  onOpenComparison,
}: Props) {
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
        className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent"
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
            <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
            {fileName ? (
              <p className="mt-1 truncate text-xs text-hq-fg-muted">{fileName}</p>
            ) : null}
          </div>

          {!timings ? (
            <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
          ) : (
            <>
              <section className="rounded-lg border border-hq-border bg-hq-canvas p-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                  {t("outcomesTitle")}
                </h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-hq-fg-muted">{t("fileSize")}</dt>
                    <dd>{formatBytes(timings.fileSizeBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-hq-fg-muted">{t("frames")}</dt>
                    <dd>{timings.frameCount}</dd>
                  </div>
                  <div>
                    <dt className="text-hq-fg-muted">{t("rows")}</dt>
                    <dd>{timings.rowCount}</dd>
                  </div>
                  <div>
                    <dt className="text-hq-fg-muted">{t("matched")}</dt>
                    <dd>{timings.matchedCount}</dd>
                  </div>
                  {timings.ocrConcurrency > 0 ? (
                    <div>
                      <dt className="text-hq-fg-muted">{t("ocrConcurrency")}</dt>
                      <dd>{timings.ocrConcurrency}</dd>
                    </div>
                  ) : null}
                  {timings.ocrFrameAvgMs != null ? (
                    <div>
                      <dt className="text-hq-fg-muted">{t("ocrFrameAvg")}</dt>
                      <dd>{formatPipelineDuration(timings.ocrFrameAvgMs)}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {showExtractionQuality ? (
                <section className="min-w-0 rounded-lg border border-hq-border bg-hq-canvas p-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                    {t("extractionTitle")}
                  </h3>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    {timings.videoDurationSeconds != null ? (
                      <>
                        <dt className="text-hq-fg-muted">{t("videoDuration")}</dt>
                        <dd className="font-mono">
                          {timings.videoDurationSeconds.toFixed(1)}s
                        </dd>
                      </>
                    ) : null}
                    {timings.frameCount != null ? (
                      <>
                        <dt className="text-hq-fg-muted">{t("framesSelected")}</dt>
                        <dd className="font-mono">{timings.frameCount}</dd>
                      </>
                    ) : null}
                    {timings.denseFrameCount != null ? (
                      <>
                        <dt className="text-hq-fg-muted">{t("framesBaseline")}</dt>
                        <dd className="font-mono">{timings.denseFrameCount}</dd>
                      </>
                    ) : null}
                    {timings.framesSkipped != null ? (
                      <>
                        <dt className="text-hq-fg-muted">{t("framesSkipped")}</dt>
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
                        <dt className="text-hq-fg-muted">{t("ocrOverlap")}</dt>
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
                <h3 className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                  {t("timelineTitle")}
                </h3>
                <ul className="mt-2 space-y-2 font-mono text-sm">
                  {sections.map((section) =>
                    section.wallMs > 0 ? (
                      <li
                        key={section.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-hq-surface-muted pb-2 last:border-0"
                      >
                        <span className="text-hq-fg">
                          {t(`section.${section.id}`)}
                        </span>
                        <span className="shrink-0 text-hq-accent">
                          {formatPipelineDuration(section.wallMs)}
                        </span>
                      </li>
                    ) : null,
                  )}
                  <li className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-hq-border pt-2 font-semibold">
                    <span className="text-hq-fg">{t("total")}</span>
                    <span className="text-hq-green">
                      {formatPipelineDuration(timings.totalMs)}
                    </span>
                  </li>
                </ul>
              </section>

              {showOcrParallelNote ? (
                <p className="text-xs text-hq-fg-muted">
                  {t("ocrParallelNote", {
                    wall: formatPipelineDuration(ocrWall),
                    uploadSum: formatPipelineDuration(ocrUploadSum),
                    extractSum: formatPipelineDuration(ocrExtractSum),
                  })}
                </p>
              ) : null}

              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                  {t("allPhasesTitle")}
                </h3>
                <ul className="mt-2 space-y-2">
                  {phaseBars.map(([phase, ms]) => (
                    <li key={phase}>
                      <div className="mb-1 flex justify-between gap-2 text-xs text-hq-fg-muted">
                        <span className="truncate font-mono">{phase}</span>
                        <span className="shrink-0">
                          {formatPipelineDuration(ms)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-hq-surface-muted">
                        <div
                          className="h-full rounded bg-hq-accent"
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
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
                {t("passComparisonTitle")}
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {comparisonJson.passes.map((pass) => (
                  <div key={pass.jobId} className="rounded-lg border border-hq-border p-3">
                    <p className="text-xs font-medium text-hq-fg-muted">
                      {pass.passKey ?? pass.passRole ?? "—"}
                    </p>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-hq-fg-muted">{t("passRows")}</dt>
                        <dd className="font-mono">{pass.rowCount}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-hq-fg-muted">{t("passMatched")}</dt>
                        <dd className="font-mono">{pass.matchedCount}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-hq-fg-muted">{t("passFrames")}</dt>
                        <dd className="font-mono">{pass.frameCount ?? "—"}</dd>
                      </div>
                      {pass.totalMs != null ? (
                        <div className="flex justify-between">
                          <dt className="text-hq-fg-muted">{t("passTime")}</dt>
                          <dd className="font-mono">{(pass.totalMs / 1000).toFixed(1)}s</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-hq-fg-muted">
                {t("passOverlap", {
                  overlap: comparisonJson.overlapCount,
                  onlyA: comparisonJson.onlyInPrimary,
                  onlyB: comparisonJson.onlyInShadow,
                })}
              </div>
              {onOpenComparison ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenComparison();
                  }}
                  className="mt-3 rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-accent hover:bg-hq-surface-muted"
                >
                  {t("openPassComparison")}
                </button>
              ) : null}
            </section>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg hover:bg-hq-surface-muted"
            >
              {t("close")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
