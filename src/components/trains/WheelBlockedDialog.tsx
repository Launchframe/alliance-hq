"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import type { TrainRollErrorDetails } from "@/lib/trains/roll-errors.shared";
import type { PoolType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  details: TrainRollErrorDetails | null;
  /** Used when the error payload omitted poolType (legacy / POOL_UNAVAILABLE). */
  fallbackPoolType?: PoolType | null;
  busy?: boolean;
  /** Manual pick is available for today's role. */
  canPickManually?: boolean;
  onClose: () => void;
  /** Re-seed the pool, then retry the spin that failed. */
  onReseedAndRespin?: (poolType: PoolType) => void;
  /** Open the conductor/VIP pick modal for the role that failed. */
  onPickManually?: () => void;
  /** Retry the spin that failed (when reseed isn't the fix). */
  onRetrySpin?: () => void;
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
      if (details.candidateKind === "vs") {
        return "wheelBlocked.noVsScores";
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

function resolveReseedPoolType(
  details: TrainRollErrorDetails,
  fallbackPoolType?: PoolType | null,
): PoolType | null {
  const poolType = details.poolType ?? fallbackPoolType ?? null;
  if (
    poolType !== "r3" &&
    poolType !== "r4_plus" &&
    poolType !== "heavy_hitter"
  ) {
    return null;
  }
  if (
    details.code === "POOL_EXHAUSTED" ||
    details.code === "POOL_UNAVAILABLE"
  ) {
    return poolType;
  }
  return null;
}

function primaryLinkCta(
  details: TrainRollErrorDetails,
): { href: string; labelKey: string } | null {
  if (details.code === "POOL_EMPTY") {
    if (details.poolType === "heavy_hitter") {
      return {
        href: "/settings/trains",
        labelKey: "wheelBlocked.goToTrainSettings",
      };
    }
    return { href: "/members", labelKey: "wheelBlocked.goToMembers" };
  }
  if (details.code === "NO_WHEEL_CANDIDATES" && details.candidateKind === "vs") {
    return {
      href: "/tools/video-upload",
      labelKey: "wheelBlocked.uploadScoreVideo",
    };
  }
  if (details.code === "ASHED_REQUIRED") {
    return {
      href: "/settings",
      labelKey: "wheelBlocked.goToSettings",
    };
  }
  return null;
}

function showPickManuallyCta(details: TrainRollErrorDetails): boolean {
  return (
    details.code === "NO_WHEEL_CANDIDATES" || details.code === "ASHED_REQUIRED"
  );
}

function showRetrySpinCta(details: TrainRollErrorDetails): boolean {
  return (
    details.code === "NO_WHEEL_CANDIDATES" && details.candidateKind === "vs"
  );
}

export function WheelBlockedDialog({
  open,
  details,
  fallbackPoolType = null,
  busy = false,
  canPickManually = false,
  onClose,
  onReseedAndRespin,
  onPickManually,
  onRetrySpin,
}: Props) {
  const t = useTranslations("trains");

  if (!details) return null;

  const bodyKey = bodyMessageKey(details);
  const reseedPoolType = resolveReseedPoolType(details, fallbackPoolType);
  const showReseed = reseedPoolType != null && onReseedAndRespin != null;
  const linkCta = primaryLinkCta(details);
  const showPick =
    canPickManually &&
    showPickManuallyCta(details) &&
    onPickManually != null;
  const showRetry =
    showRetrySpinCta(details) && onRetrySpin != null && !showReseed;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={t("wheelBlocked.title")}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("wheelBlocked.title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
            {t(bodyKey)}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
          >
            {t("wheelBlocked.close")}
          </button>

          {showPick ? (
            <button
              type="button"
              disabled={busy}
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
              disabled={busy}
              onClick={() => {
                onClose();
                onRetrySpin();
              }}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {t("wheelBlocked.retrySpin")}
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
              disabled={busy}
              onClick={() => onReseedAndRespin(reseedPoolType)}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy
                ? t("wheelBlocked.reseedAndRespinBusy")
                : t("wheelBlocked.reseedAndRespin")}
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
