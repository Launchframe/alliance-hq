"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import type { TrainRollErrorDetails } from "@/lib/trains/roll-errors.shared";
import type { PoolType, WeekTemplateType } from "@/lib/trains/types";
import {
  resolveWheelBlockedReseedPoolType,
  shouldShowWheelBlockedLeadTimeLink,
  shouldShowWheelBlockedManualPick,
  wheelBlockedReseedLabelKey,
  wheelBlockedVsBodyKey,
} from "@/lib/trains/wheel-blocked-cta.shared";

type Props = {
  open: boolean;
  details: TrainRollErrorDetails | null;
  /** Used when the error payload omitted poolType (legacy / POOL_UNAVAILABLE). */
  fallbackPoolType?: PoolType | null;
  /** Day paint — suppresses reseed for Price Is Freight with-replacement. */
  paintTemplate?: WeekTemplateType | string | null;
  /** Deep-link for VS score upload (vs-performance + recorded date). */
  uploadHref?: string;
  busy?: boolean;
  rosterSyncBusy?: boolean;
  rosterSyncNotice?: string | null;
  rosterSyncNoticeTone?: "success" | "warning" | "error";
  /** Manual pick is available for today's role. */
  canPickManually?: boolean;
  canSyncRoster?: boolean;
  onClose: () => void;
  /** Re-seed the pool, then retry the spin that failed. */
  onReseedAndRespin?: (poolType: PoolType) => void;
  /** Open the conductor/VIP pick modal for the role that failed. */
  onPickManually?: () => void;
  /** Retry the spin that failed (when reseed isn't the fix). */
  onRetrySpin?: () => void;
  onSyncRoster?: () => void;
};

function bodyMessageKey(details: TrainRollErrorDetails): string {
  switch (details.code) {
    case "POOL_EMPTY":
      if (details.poolType === "r3") return "wheelBlocked.poolEmptyR3";
      if (details.poolType === "r4_plus") return "wheelBlocked.poolEmptyR4Plus";
      if (details.poolType === "heavy_hitter") {
        return "wheelBlocked.poolEmptyHeavyHitter";
      }
      return "wheelBlocked.poolEmptyGeneric";
    case "POOL_EXHAUSTED":
      return "wheelBlocked.poolExhausted";
    case "POOL_UNAVAILABLE":
      return "wheelBlocked.poolUnavailable";
    case "NO_WHEEL_CANDIDATES":
      if (details.spinBlockReason === "day_spin_exhausted") {
        return "wheelBlocked.daySpinExhausted";
      }
      if (details.candidateKind === "vs") {
        return wheelBlockedVsBodyKey(details);
      }
      if (details.candidateKind === "vr") {
        return "wheelBlocked.noVrStandings";
      }
      if (details.candidateKind === "event") {
        return "wheelBlocked.noEventScores";
      }
      if (details.candidateKind === "donation") {
        return "wheelBlocked.noDonationScores";
      }
      return "wheelBlocked.noCandidatesGeneric";
    case "ASHED_REQUIRED":
      return "wheelBlocked.ashedRequired";
    default:
      return "wheelBlocked.generic";
  }
}

function primaryLinkCta(
  details: TrainRollErrorDetails,
  options?: {
    canSyncRoster?: boolean;
    rosterSyncSucceeded?: boolean;
    uploadHref?: string;
  },
): { href: string; labelKey: string } | null {
  if (details.code === "POOL_EMPTY") {
    if (details.poolType === "heavy_hitter") {
      return {
        href: "/settings/trains",
        labelKey: "wheelBlocked.goToTrainSettings",
      };
    }
    if (options?.canSyncRoster && !options.rosterSyncSucceeded) {
      return null;
    }
    return { href: "/members", labelKey: "wheelBlocked.goToMembers" };
  }
  if (details.code === "NO_WHEEL_CANDIDATES" && details.candidateKind === "vs") {
    if (details.spinBlockReason === "day_spin_exhausted") {
      return null;
    }
    return {
      href:
        options?.uploadHref ??
        "/tools/video-upload?scoreTarget=vs-performance",
      labelKey: "wheelBlocked.uploadScoreVideo",
    };
  }
  if (details.code === "NO_WHEEL_CANDIDATES" && details.candidateKind === "vr") {
    return { href: "/members", labelKey: "wheelBlocked.goToMembers" };
  }
  if (details.code === "ASHED_REQUIRED") {
    return {
      href: "/settings",
      labelKey: "wheelBlocked.goToSettings",
    };
  }
  return null;
}

function showRetrySpinCta(details: TrainRollErrorDetails): boolean {
  return (
    details.code === "NO_WHEEL_CANDIDATES" && details.candidateKind === "vs"
  );
}

function noticeToneClass(
  tone: "success" | "warning" | "error" | undefined,
): string {
  if (tone === "warning") {
    return "text-amber-600 dark:text-amber-400";
  }
  if (tone === "error") {
    return "text-hq-danger";
  }
  return "text-hq-success";
}

function formatScoreWeekdayForLocale(scoreDate: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scoreDate);
  if (!match) return scoreDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString(locale, {
    timeZone: "UTC",
    weekday: "long",
  });
}

export function WheelBlockedDialog({
  open,
  details,
  fallbackPoolType = null,
  paintTemplate = null,
  uploadHref,
  busy = false,
  rosterSyncBusy = false,
  rosterSyncNotice = null,
  rosterSyncNoticeTone = "success",
  canPickManually = false,
  canSyncRoster = false,
  onClose,
  onReseedAndRespin,
  onPickManually,
  onRetrySpin,
  onSyncRoster,
}: Props) {
  const t = useTranslations("trains");
  const locale = useLocale();

  if (!details) return null;

  const dialogBusy = busy || rosterSyncBusy;
  const rosterSyncSucceeded = rosterSyncNoticeTone === "success";
  const bodyKey = bodyMessageKey(details);
  const reseedPoolType = resolveWheelBlockedReseedPoolType(
    details,
    fallbackPoolType,
    { paintTemplate },
  );
  const showReseed = reseedPoolType != null && onReseedAndRespin != null;
  const reseedLabelKey = wheelBlockedReseedLabelKey(details);
  const linkCta = primaryLinkCta(details, {
    canSyncRoster,
    rosterSyncSucceeded,
    uploadHref,
  });
  const showLeadTimeLink = shouldShowWheelBlockedLeadTimeLink(details);
  const showSyncRoster =
    canSyncRoster &&
    details.code === "POOL_EMPTY" &&
    details.poolType !== "heavy_hitter" &&
    onSyncRoster != null &&
    !rosterSyncBusy &&
    !rosterSyncSucceeded;
  const showPick =
    canPickManually &&
    shouldShowWheelBlockedManualPick(details) &&
    onPickManually != null;
  const showRetry =
    showRetrySpinCta(details) && onRetrySpin != null && !showReseed;

  const bodyParams =
    details.code === "NO_WHEEL_CANDIDATES" && details.candidateKind === "vs"
      ? {
          scoreWeekday: details.scoreDate
            ? formatScoreWeekdayForLocale(details.scoreDate, locale)
            : "",
        }
      : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !dialogBusy) onClose();
      }}
      title={t("wheelBlocked.title")}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("wheelBlocked.title")}
          </h2>
          <p
            className="mt-2 text-sm leading-relaxed text-hq-fg-muted"
            data-testid="trains-wheel-blocked-body"
          >
            {bodyParams ? t(bodyKey, bodyParams) : t(bodyKey)}
          </p>
        </div>

        {rosterSyncBusy ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5 text-sm text-cyan-800 dark:text-cyan-100"
            data-testid="trains-wheel-blocked-syncing"
            role="status"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            {t("guidedFlow.steps.roster.syncing")}
          </div>
        ) : null}

        {!rosterSyncBusy && rosterSyncNotice ? (
          <p
            className={`text-sm leading-relaxed ${noticeToneClass(rosterSyncNoticeTone)}`}
            data-testid="trains-wheel-blocked-sync-notice"
          >
            {rosterSyncNotice}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={dialogBusy}
            onClick={onClose}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
          >
            {t("wheelBlocked.close")}
          </button>

          {showPick ? (
            <button
              type="button"
              disabled={dialogBusy}
              onClick={() => {
                onPickManually();
                onClose();
              }}
              className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface disabled:opacity-50"
            >
              {t("wheelBlocked.pickManually")}
            </button>
          ) : null}

          {showRetry ? (
            <button
              type="button"
              disabled={dialogBusy}
              onClick={() => {
                onClose();
                onRetrySpin();
              }}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-500/20 dark:text-cyan-100 disabled:opacity-50"
            >
              {t("wheelBlocked.retrySpin")}
            </button>
          ) : null}

          {showLeadTimeLink ? (
            <Link
              href="/settings/trains#lead-time"
              onClick={onClose}
              className="inline-flex justify-center rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
              data-testid="trains-wheel-blocked-lead-time"
            >
              {t("wheelBlocked.goToLeadTimeSettings")}
            </Link>
          ) : null}

          {showSyncRoster ? (
            <button
              type="button"
              disabled={dialogBusy}
              onClick={() => onSyncRoster()}
              className="inline-flex justify-center rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
              data-testid="trains-wheel-blocked-sync"
            >
              {t("wheelBlocked.syncRoster")}
            </button>
          ) : null}

          {linkCta ? (
            <Link
              href={linkCta.href}
              onClick={onClose}
              className="inline-flex justify-center rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
            >
              {t(linkCta.labelKey)}
            </Link>
          ) : null}

          {showReseed ? (
            <button
              type="button"
              disabled={dialogBusy}
              onClick={() => onReseedAndRespin(reseedPoolType)}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
              data-testid="trains-wheel-blocked-reseed"
            >
              {busy
                ? t("wheelBlocked.reseedAndRespinBusy")
                : t(reseedLabelKey)}
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
