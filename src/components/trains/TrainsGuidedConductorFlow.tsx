"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  currentGuidedStep,
  guidedFlowShowPrerequisites,
  type GuidedFlowActionStep,
} from "@/lib/trains/guided-flow.shared";
import { WEEK_TEMPLATES_WITH_DETAIL_HINTS } from "@/lib/trains/week-template-registry.shared";
import type { TrainsVsDataStatus } from "@/lib/trains/vs-data-status.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

/** Default destination for the "upload score video" prerequisites link. */
const DEFAULT_VIDEO_UPLOAD_HREF = "/tools/video-upload";

export type TrainsGuidedConductorFlowProps = {
  schedulePersisted: boolean;
  templateType: WeekTemplateType | null;
  paintTemplate?: WeekTemplateType | null;
  /** Pre-translated template explainer; falls back to `trains.templateDetails.*` when omitted. */
  templateDetailHint?: string | null;
  vsDataStatus: TrainsVsDataStatus | null;
  hasConductor: boolean;
  conductorName?: string | null;
  vipNeeded: boolean;
  hasVip: boolean;
  vipName?: string | null;
  locked: boolean;
  canRoll: boolean;
  canManualPick: boolean;
  canManualPickVip: boolean;
  /** Precomputed via `canSpinConductor(...)` in the dashboard — not re-derived here. */
  canSpinConductorWheel: boolean;
  /** Precomputed via `canSpinVip(...)` in the dashboard — not re-derived here. */
  canSpinVipWheel: boolean;
  /** Used only to choose the "pick top scorer" label vs. the wheel/manual CTAs. */
  conductorMech: string | null;
  vipMech?: string | null;
  busy: boolean;
  onChangeTemplate: () => void;
  onRollConductor: () => void;
  onPickTopScorer: () => void;
  onPickConductorManual: () => void;
  onRollVip: () => void;
  onPickVipManual: () => void;
  onLock: () => void;
  /** Rendered inside the "Show advanced actions" disclosure (swap / reseed / unlock, etc). */
  advancedActions?: ReactNode;
  videoUploadHref?: string;
};

type StepId = "template" | "conductor" | "vip" | "lock" | "done";
type StepStatus = "completed" | "current" | "upcoming" | "skipped";

const STEP_ORDER: StepId[] = ["template", "conductor", "vip", "lock", "done"];

function stepStatus(
  step: StepId,
  current: GuidedFlowActionStep,
  vipNeeded: boolean,
): StepStatus {
  if (step === "vip" && !vipNeeded) return "skipped";
  const stepIndex = STEP_ORDER.indexOf(step);
  const currentIndex = STEP_ORDER.indexOf(current);
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

type PrimaryAction = { label: string; onClick: () => void } | null;

function StepMarker({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-white">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (status === "current") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-cyan-500 bg-cyan-500/15">
        <span className="h-2 w-2 rounded-full bg-cyan-500" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-hq-border bg-hq-canvas"
      aria-hidden
    />
  );
}

function PrimaryCtaButton({
  action,
  busy,
}: {
  action: PrimaryAction;
  busy: boolean;
}) {
  if (!action) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={action.onClick}
      data-testid="trains-guided-primary-cta"
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50 sm:w-auto"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {action.label}
    </button>
  );
}

function ChangeLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium text-cyan-300 hover:text-cyan-200 hover:underline"
    >
      {label}
    </button>
  );
}

function StepRow({
  status,
  title,
  isLast = false,
  children,
}: {
  status: StepStatus;
  title: string;
  isLast?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!isLast ? (
        <span
          aria-hidden
          className={`absolute left-3 top-6 h-[calc(100%-1.5rem)] w-px ${
            status === "completed" ? "bg-cyan-500/50" : "bg-hq-border"
          }`}
        />
      ) : null}
      <StepMarker status={status} />
      <div className="min-w-0 flex-1 pt-0.5">
        <h4
          className={`text-sm font-medium ${
            status === "upcoming" || status === "skipped"
              ? "text-hq-fg-muted"
              : "text-hq-fg"
          }`}
        >
          {title}
        </h4>
        {children ? <div className="mt-1.5">{children}</div> : null}
      </div>
    </li>
  );
}

export function TrainsGuidedConductorFlow(props: TrainsGuidedConductorFlowProps) {
  const {
    schedulePersisted,
    templateType,
    templateDetailHint,
    vsDataStatus,
    hasConductor,
    conductorName,
    vipNeeded,
    hasVip,
    vipName,
    locked,
    canRoll,
    canManualPick,
    canManualPickVip,
    canSpinConductorWheel,
    canSpinVipWheel,
    conductorMech,
    busy,
    onChangeTemplate,
    onRollConductor,
    onPickTopScorer,
    onPickConductorManual,
    onRollVip,
    onPickVipManual,
    onLock,
    advancedActions,
    videoUploadHref,
  } = props;

  const t = useTranslations("trains.guidedFlow");
  const tTemplates = useTranslations("trains.templates");
  const tTemplateDetails = useTranslations("trains.templateDetails");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const guidedInput = {
    schedulePersisted,
    hasConductor,
    vipNeeded,
    hasVip,
    locked,
    vsDataRequired: vsDataStatus?.required,
    vsDataReady: vsDataStatus?.ready,
  };
  const current = currentGuidedStep(guidedInput);
  const showPrerequisites = guidedFlowShowPrerequisites(guidedInput);

  const templateLabel = templateType ? tTemplates(templateType) : null;
  const templateHint =
    templateDetailHint ??
    (templateType && WEEK_TEMPLATES_WITH_DETAIL_HINTS.includes(templateType)
      ? tTemplateDetails(templateType)
      : null);

  const conductorAction: PrimaryAction = canSpinConductorWheel
    ? { label: t("steps.conductor.spin"), onClick: onRollConductor }
    : canRoll &&
        (conductorMech === "vs_high_score" || conductorMech === "donations_top")
      ? { label: t("steps.conductor.pickTop"), onClick: onPickTopScorer }
      : canManualPick
        ? { label: t("steps.conductor.pickManual"), onClick: onPickConductorManual }
        : null;

  const vipAction: PrimaryAction = canSpinVipWheel
    ? { label: t("steps.vip.spin"), onClick: onRollVip }
    : canManualPickVip
      ? { label: t("steps.vip.pickManual"), onClick: onPickVipManual }
      : null;

  const templateStatus = stepStatus("template", current, vipNeeded);
  const conductorStatus = stepStatus("conductor", current, vipNeeded);
  const vipStatus = stepStatus("vip", current, vipNeeded);
  const lockStatus = stepStatus("lock", current, vipNeeded);
  const doneStatus = stepStatus("done", current, vipNeeded);

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="trains-guided-conductor-flow"
    >
      <h3 className="text-sm font-medium text-hq-fg-muted">{t("heading")}</h3>

      {showPrerequisites ? (
        <div
          className="flex flex-col gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5"
          data-testid="trains-guided-prerequisites"
        >
          <span className="text-[10px] font-medium uppercase tracking-wide text-cyan-300">
            {t("steps.prerequisites.title")}
          </span>
          <p className="text-sm text-hq-fg">{t("steps.prerequisites.bodyMissing")}</p>
          <Link
            href={videoUploadHref ?? DEFAULT_VIDEO_UPLOAD_HREF}
            className="text-sm font-medium text-cyan-300 hover:text-cyan-200 hover:underline"
          >
            {t("steps.prerequisites.uploadLink")} →
          </Link>
        </div>
      ) : null}

      <ol className="flex flex-col">
        <StepRow status={templateStatus} title={t("steps.template.title")}>
          <div className="flex flex-wrap items-center gap-2">
            {templateLabel ? (
              <span className="text-sm text-hq-fg-muted">{templateLabel}</span>
            ) : null}
            {templateStatus === "current" ? (
              <PrimaryCtaButton
                action={{ label: t("steps.template.change"), onClick: onChangeTemplate }}
                busy={busy}
              />
            ) : (
              <ChangeLink label={t("steps.template.change")} onClick={onChangeTemplate} />
            )}
          </div>
          {templateStatus === "current" && templateHint ? (
            <p className="mt-1.5 text-xs leading-relaxed text-hq-fg-muted">
              {templateHint}
            </p>
          ) : null}
        </StepRow>

        <StepRow status={conductorStatus} title={t("steps.conductor.title")}>
          {conductorStatus === "completed" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-hq-fg-muted">
                {t("steps.conductor.assigned", { name: conductorName ?? "—" })}
              </span>
              {!locked && canManualPick ? (
                <ChangeLink
                  label={t("steps.conductor.change")}
                  onClick={onPickConductorManual}
                />
              ) : null}
            </div>
          ) : conductorStatus === "current" ? (
            <div className="flex flex-col gap-2">
              {vsDataStatus?.required && vsDataStatus.ready ? (
                <p className="text-xs text-hq-fg-muted">
                  {t("steps.prerequisites.bodyReady", {
                    count: vsDataStatus.scoreCount,
                  })}
                </p>
              ) : null}
              <PrimaryCtaButton action={conductorAction} busy={busy} />
            </div>
          ) : null}
        </StepRow>

        <StepRow status={vipStatus} title={t("steps.vip.title")}>
          {vipStatus === "skipped" ? (
            <p className="text-sm text-hq-fg-muted">{t("steps.vip.skipped")}</p>
          ) : vipStatus === "completed" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-hq-fg-muted">
                {t("steps.vip.assigned", { name: vipName ?? "—" })}
              </span>
              {!locked && canManualPickVip ? (
                <ChangeLink label={t("steps.vip.change")} onClick={onPickVipManual} />
              ) : null}
            </div>
          ) : vipStatus === "current" ? (
            <PrimaryCtaButton action={vipAction} busy={busy} />
          ) : null}
        </StepRow>

        <StepRow status={lockStatus} title={t("steps.lock.title")}>
          {lockStatus === "current" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-hq-fg-muted">{t("steps.lock.ready")}</p>
              <PrimaryCtaButton
                action={{ label: t("steps.lock.lockCta"), onClick: onLock }}
                busy={busy}
              />
            </div>
          ) : null}
        </StepRow>

        <StepRow status={doneStatus} title={t("steps.done.title")} isLast>
          <div className="flex flex-col gap-2">
            {doneStatus === "current" ? (
              <p className="text-sm text-hq-fg-muted">{t("steps.done.summary")}</p>
            ) : null}
            {advancedActions ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  data-testid="trains-guided-advanced-toggle"
                  className="inline-flex items-center gap-1 text-sm font-medium text-cyan-300 hover:text-cyan-200 hover:underline"
                >
                  {showAdvanced ? t("steps.done.hideAdvanced") : t("steps.done.showAdvanced")}
                  {showAdvanced ? (
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
                {showAdvanced ? (
                  <div className="mt-3 flex flex-col gap-3 border-t border-hq-border pt-3">
                    {advancedActions}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </StepRow>
      </ol>
    </div>
  );
}
