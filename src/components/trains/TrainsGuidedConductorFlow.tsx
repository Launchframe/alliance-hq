"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  currentGuidedStep,
  type GuidedFlowStep,
} from "@/lib/trains/guided-flow.shared";
import { buildConnectHref } from "@/lib/connect/connect-return-path.shared";
import { rosterSyncCapabilityAllowsInPageSync } from "@/lib/trains/roster-data-status.shared";
import type { TrainsRosterDataStatus } from "@/lib/trains/roster-data-status.shared";
import { WEEK_TEMPLATES_WITH_DETAIL_HINTS } from "@/lib/trains/week-template-registry.shared";
import type { TrainsVsDataStatus } from "@/lib/trains/vs-data-status.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

/** Default destination for the "upload score video" prerequisites link. */
const DEFAULT_VIDEO_UPLOAD_HREF = "/tools/video-upload";

export type TrainsGuidedConductorFlowProps = {
  templateType: WeekTemplateType | null;
  paintTemplate?: WeekTemplateType | null;
  /** Pre-translated template explainer; falls back to `trains.templateDetails.*` when omitted. */
  templateDetailHint?: string | null;
  vsDataStatus: TrainsVsDataStatus | null;
  rosterDataStatus: TrainsRosterDataStatus | null;
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
  /** Clear an unlocked pending conductor draft (releases the pool slot). */
  onClearPendingConductor?: () => void;
  onRollVip: () => void;
  onPickVipManual: () => void;
  onLock: () => void;
  /** Inline lock confirmation (e.g. Discord announce) — replaces the lock CTA in the Lock step. */
  lockConfirm?: ReactNode;
  /** Pool remaining + View pool — same panel as advanced mode, for depleting pools. */
  poolPanel?: ReactNode;
  /** Rendered inside the "Show advanced actions" disclosure (swap / reseed / unlock, etc). */
  advancedActions?: ReactNode;
  videoUploadHref?: string;
  rosterSyncBusy?: boolean;
  rosterSyncNotice?: string | null;
  rosterSyncNoticeTone?: "success" | "warning" | "error";
  onSyncRoster?: () => void;
  /** Share image export when a conductor is already assigned. */
  onShareImage?: () => void;
  shareBusy?: boolean;
};

type StepId =
  | "roster"
  | "prerequisites"
  | "template"
  | "conductor"
  | "vip"
  | "lock"
  | "done";
type StepStatus = "completed" | "current" | "upcoming" | "skipped";

const STEP_ORDER: StepId[] = [
  "template",
  "roster",
  "prerequisites",
  "conductor",
  "lock",
  "vip",
  "done",
];

function stepStatus(
  step: StepId,
  current: GuidedFlowStep,
  vipNeeded: boolean,
  vsDataRequired: boolean,
  rosterDataRequired: boolean,
): StepStatus {
  if (step === "vip" && !vipNeeded) return "skipped";
  if (step === "prerequisites" && !vsDataRequired) return "skipped";
  if (step === "roster" && !rosterDataRequired) return "skipped";
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

function ChangeLink({
  label,
  onClick,
  testId,
}: {
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
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
    templateType,
    paintTemplate,
    templateDetailHint,
    vsDataStatus,
    rosterDataStatus,
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
    onClearPendingConductor,
    onRollVip,
    onPickVipManual,
    onLock,
    lockConfirm,
    poolPanel,
    advancedActions,
    videoUploadHref,
    rosterSyncBusy = false,
    rosterSyncNotice = null,
    rosterSyncNoticeTone = "success",
    onSyncRoster,
    onShareImage,
    shareBusy = false,
  } = props;
  const tWheel = useTranslations("trains.wheel");

  const connectAshedHref = buildConnectHref("/trains");

  const t = useTranslations("trains.guidedFlow");
  const tTemplates = useTranslations("trains.templates");
  const tTemplateDetails = useTranslations("trains.templateDetails");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const lockStepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lockConfirm || !lockStepRef.current) return;
    lockStepRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lockConfirm]);

  const vsRequired = Boolean(vsDataStatus?.required && !canManualPick);
  const rosterRequired = Boolean(rosterDataStatus?.required);
  const guidedInput = {
    hasConductor,
    vipNeeded,
    hasVip,
    locked,
    rosterDataRequired: rosterDataStatus?.required,
    rosterDataReady: rosterDataStatus?.ready,
    vsDataRequired: vsDataStatus?.required,
    vsDataReady: vsDataStatus?.ready,
    conductorManualPickAvailable: canManualPick,
  };
  const current = currentGuidedStep(guidedInput);

  const dayConductorPick = paintTemplate ?? templateType;
  const conductorPickLabel = dayConductorPick ? tTemplates(dayConductorPick) : null;
  const conductorPickHint =
    templateDetailHint ??
    (dayConductorPick && WEEK_TEMPLATES_WITH_DETAIL_HINTS.includes(dayConductorPick)
      ? tTemplateDetails(dayConductorPick)
      : null);

  const conductorAction: PrimaryAction = canSpinConductorWheel
    ? { label: t("steps.conductor.spin"), onClick: onRollConductor }
    : canRoll &&
        (conductorMech === "vs_high_score" ||
          conductorMech === "vs_top_n" ||
          conductorMech === "donations_top") &&
        !canSpinConductorWheel
      ? { label: t("steps.conductor.pickTop"), onClick: onPickTopScorer }
      : null;

  const showSecondaryPickConductor =
    canManualPick && conductorAction?.onClick !== onPickConductorManual;

  const vipAction: PrimaryAction = canSpinVipWheel
    ? { label: t("steps.vip.spin"), onClick: onRollVip }
    : canManualPickVip
      ? { label: t("steps.vip.pickManual"), onClick: onPickVipManual }
      : null;

  const showSecondaryPickVip =
    canManualPickVip && vipAction?.onClick !== onPickVipManual;

  const prerequisitesStatus = stepStatus(
    "prerequisites",
    current,
    vipNeeded,
    vsRequired,
    rosterRequired,
  );
  const rosterStatus = stepStatus(
    "roster",
    current,
    vipNeeded,
    vsRequired,
    rosterRequired,
  );
  const templateStatus = stepStatus(
    "template",
    current,
    vipNeeded,
    vsRequired,
    rosterRequired,
  );
  const conductorStatus = stepStatus(
    "conductor",
    current,
    vipNeeded,
    vsRequired,
    rosterRequired,
  );
  const vipStatus = stepStatus("vip", current, vipNeeded, vsRequired, rosterRequired);
  const lockStatus = stepStatus("lock", current, vipNeeded, vsRequired, rosterRequired);
  const doneStatus = stepStatus("done", current, vipNeeded, vsRequired, rosterRequired);

  const rosterRankLabel =
    rosterDataStatus?.poolType != null
      ? t(`steps.roster.rankLabels.${rosterDataStatus.poolType}`)
      : null;
  const rosterBodyKey =
    rosterDataStatus?.blockerKind === "conductor_minimums"
      ? "steps.roster.bodyConductorMinimums"
      : rosterDataStatus?.blockerKind === "missing_rank_pool"
        ? "steps.roster.bodyMissingRanks"
        : rosterDataStatus?.activeMemberCount === 0
          ? "steps.roster.bodyEmpty"
          : "steps.roster.bodyEmpty";
  const canInPageRosterSync =
    rosterDataStatus != null &&
    rosterSyncCapabilityAllowsInPageSync(rosterDataStatus.syncCapability);
  const showRosterSyncCta =
    canInPageRosterSync &&
    onSyncRoster != null &&
    (rosterDataStatus?.blockerKind === "empty_roster" ||
      rosterDataStatus?.blockerKind === "missing_rank_pool");
  const showRosterMembersLink =
    rosterDataStatus?.blockerKind === "missing_rank_pool" &&
    !canInPageRosterSync;
  const showRosterUploadScores =
    rosterDataStatus?.blockerKind === "conductor_minimums" &&
    canSpinConductorWheel &&
    !canManualPick;
  const rosterPrimaryLabel =
    rosterDataStatus?.syncCapability === "native_reload"
      ? t("steps.roster.refreshNative")
      : t("steps.roster.syncAshed");

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="trains-guided-conductor-flow"
    >
      <h3 className="text-sm font-medium text-hq-fg-muted">{t("heading")}</h3>

      {poolPanel ? (
        <div data-testid="trains-guided-pool-panel">{poolPanel}</div>
      ) : null}

      <ol className="flex flex-col">
        <StepRow status={templateStatus} title={t("steps.template.title")}>
          <div className="flex flex-wrap items-center gap-2">
            {conductorPickLabel ? (
              <span className="text-sm text-hq-fg-muted">{conductorPickLabel}</span>
            ) : null}
            {!locked ? (
              <ChangeLink label={t("steps.template.change")} onClick={onChangeTemplate} />
            ) : null}
          </div>
          {conductorPickHint ? (
            <p className="mt-1.5 text-xs leading-relaxed text-hq-fg-muted">
              {conductorPickHint}
            </p>
          ) : null}
        </StepRow>

        {rosterStatus !== "skipped" ? (
          <StepRow status={rosterStatus} title={t("steps.roster.title")}>
            {rosterStatus === "current" ? (
              <div
                className="flex flex-col gap-2"
                data-testid="trains-guided-roster"
              >
                <p className="text-sm text-hq-fg">
                  {rosterDataStatus?.syncCapability === "none"
                    ? t("steps.roster.bodyNoSyncPath")
                    : t(rosterBodyKey, {
                        rankLabel: rosterRankLabel ?? "",
                      })}
                </p>
                {rosterSyncNotice ? (
                  <p
                    className={
                      rosterSyncNoticeTone === "warning"
                        ? "text-xs text-amber-600 dark:text-amber-400"
                        : rosterSyncNoticeTone === "error"
                          ? "text-xs text-hq-danger"
                          : "text-xs text-hq-success"
                    }
                  >
                    {rosterSyncNotice}
                  </p>
                ) : null}
                {showRosterSyncCta ? (
                  <PrimaryCtaButton
                    action={{
                      label: rosterSyncBusy
                        ? t("steps.roster.syncing")
                        : rosterPrimaryLabel,
                      onClick: onSyncRoster,
                    }}
                    busy={busy || rosterSyncBusy}
                  />
                ) : null}
                {rosterDataStatus?.syncCapability === "none" ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Link
                      href={connectAshedHref}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 sm:w-auto"
                    >
                      {t("steps.roster.connectAshed")}
                    </Link>
                    <Link
                      href="/members"
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface sm:w-auto"
                    >
                      {t("steps.roster.goToMembers")}
                    </Link>
                  </div>
                ) : showRosterUploadScores ? (
                  <Link
                    href={videoUploadHref ?? DEFAULT_VIDEO_UPLOAD_HREF}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 sm:w-auto"
                  >
                    {t("steps.prerequisites.uploadLink")}
                  </Link>
                ) : showRosterMembersLink ? (
                  <Link
                    href="/members"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface sm:w-auto"
                  >
                    {t("steps.roster.goToMembers")}
                  </Link>
                ) : null}
              </div>
            ) : rosterStatus === "completed" ? (
              <p className="text-xs text-hq-fg-muted">
                {t("steps.roster.syncSuccess", {
                  count: rosterDataStatus?.activeMemberCount ?? 0,
                })}
              </p>
            ) : null}
          </StepRow>
        ) : null}

        {prerequisitesStatus !== "skipped" ? (
          <StepRow
            status={prerequisitesStatus}
            title={t("steps.prerequisites.title")}
          >
            {prerequisitesStatus === "current" ? (
              <div
                className="flex flex-col gap-2"
                data-testid="trains-guided-prerequisites"
              >
                <p className="text-sm text-hq-fg">
                  {t("steps.prerequisites.bodyMissing")}
                </p>
                <Link
                  href={videoUploadHref ?? DEFAULT_VIDEO_UPLOAD_HREF}
                  data-testid="trains-guided-upload-link"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 sm:w-auto"
                >
                  {t("steps.prerequisites.uploadLink")}
                </Link>
              </div>
            ) : prerequisitesStatus === "completed" ? (
              <p className="text-xs text-hq-fg-muted">
                {t("steps.prerequisites.bodyReady", {
                  count: vsDataStatus?.scoreCount ?? 0,
                })}
              </p>
            ) : null}
          </StepRow>
        ) : null}

        <StepRow status={conductorStatus} title={t("steps.conductor.title")}>
          {conductorStatus === "completed" ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-hq-fg-muted">
                  {t("steps.conductor.assigned", { name: conductorName ?? "—" })}
                </span>
                {!locked && canSpinConductorWheel ? (
                  <ChangeLink
                    label={tWheel("spinAgain")}
                    onClick={onRollConductor}
                    testId="trains-guided-spin-again"
                  />
                ) : null}
                {!locked &&
                canRoll &&
                (conductorMech === "vs_high_score" ||
                  conductorMech === "vs_top_n") &&
                !canSpinConductorWheel ? (
                  <ChangeLink
                    label={t("steps.conductor.pickTop")}
                    onClick={onPickTopScorer}
                  />
                ) : null}
                {!locked && canManualPick ? (
                  <ChangeLink
                    label={t("steps.conductor.change")}
                    onClick={onPickConductorManual}
                  />
                ) : null}
                {!locked && onClearPendingConductor ? (
                  <button
                    type="button"
                    disabled={busy}
                    data-testid="trains-clear-pending-conductor"
                    onClick={onClearPendingConductor}
                    className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-surface disabled:opacity-50"
                  >
                    {t("steps.conductor.clear")}
                  </button>
                ) : null}
              </div>
              {onShareImage ? (
                <button
                  type="button"
                  disabled={shareBusy || busy}
                  data-testid="trains-guided-share-image"
                  onClick={onShareImage}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-[#8957e5]/50 bg-[#8957e5]/10 px-4 py-2 text-sm font-medium text-[#8250df] hover:bg-[#8957e5]/20 disabled:opacity-50 sm:w-auto dark:text-[#d2a8ff]"
                >
                  {shareBusy
                    ? tWheel("share.exporting")
                    : tWheel("share.action")}
                </button>
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
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {conductorAction ? (
                  <PrimaryCtaButton action={conductorAction} busy={busy} />
                ) : canManualPick ? (
                  <PrimaryCtaButton
                    action={{
                      label: t("steps.conductor.pickManual"),
                      onClick: onPickConductorManual,
                    }}
                    busy={busy}
                  />
                ) : null}
                {showSecondaryPickConductor ? (
                  <button
                    type="button"
                    onClick={onPickConductorManual}
                    data-testid="trains-guided-pick-conductor"
                    className="inline-flex w-full items-center justify-center rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface sm:w-auto"
                  >
                    {t("steps.conductor.pickManual")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </StepRow>

        <StepRow status={lockStatus} title={t("steps.lock.title")}>
          {lockStatus === "current" ? (
            <div ref={lockStepRef} className="flex flex-col gap-2">
              <p className="text-sm text-hq-fg-muted">{t("steps.lock.ready")}</p>
              {lockConfirm ?? (
                <PrimaryCtaButton
                  action={{ label: t("steps.lock.lockCta"), onClick: onLock }}
                  busy={busy}
                />
              )}
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
              {canManualPickVip ? (
                <ChangeLink label={t("steps.vip.change")} onClick={onPickVipManual} />
              ) : null}
            </div>
          ) : vipStatus === "current" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {vipAction ? (
                <PrimaryCtaButton action={vipAction} busy={busy} />
              ) : null}
              {showSecondaryPickVip ? (
                <button
                  type="button"
                  onClick={onPickVipManual}
                  data-testid="trains-guided-pick-vip"
                  className="inline-flex w-full items-center justify-center rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface sm:w-auto"
                >
                  {t("steps.vip.pickManual")}
                </button>
              ) : null}
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
                {/* Keep advanced actions mounted (hidden) so spin-week hotkey /
                    walkthrough targets remain queryable while collapsed. */}
                <div
                  className={
                    showAdvanced
                      ? "mt-3 flex flex-col gap-3 border-t border-hq-border pt-3"
                      : "hidden"
                  }
                >
                  {advancedActions}
                </div>
              </div>
            ) : null}
          </div>
        </StepRow>
      </ol>
    </div>
  );
}
