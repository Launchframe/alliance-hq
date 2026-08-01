"use client";

import { Settings2 } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Dialog } from "@/components/ui/dialog";
import { VideoPipelineStatsButton } from "@/components/video/VideoPipelineStatsDialog";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import type { PassComparison } from "@/lib/video/compare-pass-results";

type SettingsToggleProps = {
  label: string;
  description?: string;
  pressed: boolean;
  disabled?: boolean;
  onPressedChange: (next: boolean) => void;
};

function SettingsToggle({
  label,
  description,
  pressed,
  disabled,
  onPressedChange,
}: SettingsToggleProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div className="flex items-start justify-between gap-3 border-b border-hq-border py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-sm font-medium text-hq-fg">
          {label}
        </p>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs text-hq-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={pressed}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onPressedChange(!pressed)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          pressed
            ? "border-hq-accent bg-hq-accent/30"
            : "border-hq-border bg-hq-canvas"
        }`}
      >
        <span
          className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-hq-fg shadow transition-transform ${
            pressed ? "translate-x-[1.375rem]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export type VideoReviewSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showDepositSlipToggles: boolean;
  fillMissingDepositTimes: boolean;
  onFillMissingDepositTimesChange: (next: boolean) => void;
  fillMissingDepositAmounts: boolean;
  onFillMissingDepositAmountsChange: (next: boolean) => void;
  showFollowMe: boolean;
  followMeEnabled: boolean;
  followMeDisabled?: boolean;
  onFollowMeChange: (next: boolean) => void;
  showDepositSlipPreviewMode: boolean;
  depositSlipPreviewMode: "video" | "frames";
  depositSlipPreviewModeFramesDisabled?: boolean;
  onDepositSlipPreviewModeChange: (mode: "video" | "frames") => void;
  timings: VideoProcessTimings | null;
  fileName: string | null;
  comparisonJson: PassComparison | null;
  onOpenComparison?: () => void;
  showInspect: boolean;
  inspectHref: string;
  showReprocess: boolean;
  reprocessPending: boolean;
  onReprocessClick: () => void;
};

export function VideoReviewSettingsDialog({
  open,
  onOpenChange,
  showDepositSlipToggles,
  fillMissingDepositTimes,
  onFillMissingDepositTimesChange,
  fillMissingDepositAmounts,
  onFillMissingDepositAmountsChange,
  showFollowMe,
  followMeEnabled,
  followMeDisabled,
  onFollowMeChange,
  showDepositSlipPreviewMode,
  depositSlipPreviewMode,
  depositSlipPreviewModeFramesDisabled,
  onDepositSlipPreviewModeChange,
  timings,
  fileName,
  comparisonJson,
  onOpenComparison,
  showInspect,
  inspectHref,
  showReprocess,
  reprocessPending,
  onReprocessClick,
}: VideoReviewSettingsDialogProps) {
  const t = useTranslations("videoReview");
  const tJobs = useTranslations("videoJobs");

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("reviewSettingsTitle")}
      className="max-w-md"
    >
      <div className="max-h-[min(70vh,32rem)] overflow-y-auto px-4 pb-4">
        {showDepositSlipToggles ? (
          <>
            <SettingsToggle
              label={t("fillMissingDepositAmounts")}
              description={t("fillMissingDepositAmountsHint")}
              pressed={fillMissingDepositAmounts}
              onPressedChange={onFillMissingDepositAmountsChange}
            />
            <SettingsToggle
              label={t("fillMissingDepositTimes")}
              description={t("fillMissingDepositTimesHint")}
              pressed={fillMissingDepositTimes}
              onPressedChange={onFillMissingDepositTimesChange}
            />
          </>
        ) : null}

        {showFollowMe ? (
          <SettingsToggle
            label={t("followMe")}
            description={t("followMeHint")}
            pressed={followMeEnabled}
            disabled={followMeDisabled}
            onPressedChange={onFollowMeChange}
          />
        ) : null}

        {showDepositSlipPreviewMode ? (
          <div className="border-b border-hq-border py-3">
            <p className="text-sm font-medium text-hq-fg">
              {t("depositSlipPreviewModeGroup")}
            </p>
            <div
              className="mt-2 inline-flex rounded-lg border border-hq-border p-0.5"
              role="group"
              aria-label={t("depositSlipPreviewModeGroup")}
            >
              <button
                type="button"
                onClick={() => onDepositSlipPreviewModeChange("video")}
                aria-pressed={depositSlipPreviewMode === "video"}
                className={`rounded-md px-2.5 py-1 text-sm ${
                  depositSlipPreviewMode === "video"
                    ? "bg-hq-accent/20 text-hq-accent"
                    : "text-hq-fg hover:bg-hq-surface-muted"
                }`}
              >
                {t("depositSlipPreviewModeFullVideo")}
              </button>
              <button
                type="button"
                disabled={depositSlipPreviewModeFramesDisabled}
                onClick={() => onDepositSlipPreviewModeChange("frames")}
                aria-pressed={depositSlipPreviewMode === "frames"}
                className={`rounded-md px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  depositSlipPreviewMode === "frames"
                    ? "bg-hq-accent/20 text-hq-accent"
                    : "text-hq-fg hover:bg-hq-surface-muted"
                }`}
              >
                {t("depositSlipPreviewModeFrames")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-b border-hq-border py-3">
          <VideoPipelineStatsButton
            timings={timings}
            fileName={fileName}
            comparisonJson={comparisonJson}
            onOpenComparison={onOpenComparison}
          />
          {showInspect ? (
            <Link
              href={inspectHref}
              className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent"
              onClick={() => onOpenChange(false)}
            >
              {tJobs("inspect")}
            </Link>
          ) : null}
          {showReprocess ? (
            <button
              type="button"
              disabled={reprocessPending}
              onClick={() => {
                onOpenChange(false);
                onReprocessClick();
              }}
              className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent disabled:opacity-50"
            >
              {reprocessPending ? t("reprocessing") : t("reprocess")}
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

type VideoReviewSettingsFabProps = {
  onClick: () => void;
};

/** Mobile FAB — opens {@link VideoReviewSettingsDialog}. */
export function VideoReviewSettingsFab({ onClick }: VideoReviewSettingsFabProps) {
  const t = useTranslations("videoReview");

  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-20 left-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-hq-border bg-hq-surface text-hq-fg shadow-lg hover:bg-hq-surface-muted md:hidden"
      aria-label={t("reviewSettingsTitle")}
    >
      <Settings2 className="h-5 w-5" aria-hidden />
    </button>
  );
}

type VideoReviewSettingsTriggerProps = {
  onClick: () => void;
};

/** Desktop toolbar gear — hidden below `md` (use FAB on mobile). */
export function VideoReviewSettingsTrigger({
  onClick,
}: VideoReviewSettingsTriggerProps) {
  const t = useTranslations("videoReview");

  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden items-center gap-1.5 rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted md:inline-flex"
      aria-label={t("reviewSettingsTitle")}
    >
      <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
      {t("reviewSettingsTitle")}
    </button>
  );
}
