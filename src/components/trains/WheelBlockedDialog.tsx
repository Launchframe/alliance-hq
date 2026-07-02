"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import type { TrainRollErrorDetails } from "@/lib/trains/roll-errors.shared";
import type { PoolType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  details: TrainRollErrorDetails | null;
  onClose: () => void;
  onReseedPool?: (poolType: PoolType) => void;
};

function bodyMessageKey(details: TrainRollErrorDetails): string {
  switch (details.code) {
    case "POOL_EMPTY":
      if (details.poolType === "r3") return "wheelBlocked.poolEmptyR3";
      if (details.poolType === "r4_plus") return "wheelBlocked.poolEmptyR4Plus";
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

function showMembersCta(details: TrainRollErrorDetails): boolean {
  return (
    details.code === "POOL_EMPTY" &&
    (details.poolType === "r3" || details.poolType === "r4_plus")
  );
}

function showReseedCta(details: TrainRollErrorDetails): boolean {
  return (
    details.code === "POOL_EXHAUSTED" &&
    (details.poolType === "r3" || details.poolType === "r4_plus")
  );
}

export function WheelBlockedDialog({
  open,
  details,
  onClose,
  onReseedPool,
}: Props) {
  const t = useTranslations("trains");

  if (!details) return null;

  const bodyKey = bodyMessageKey(details);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={t("wheelBlocked.title")}>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3]">
            {t("wheelBlocked.title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
            {t(bodyKey)}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
          >
            {t("wheelBlocked.close")}
          </button>

          {showMembersCta(details) ? (
            <Link
              href="/members"
              onClick={onClose}
              className="inline-flex justify-center rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
            >
              {t("wheelBlocked.goToMembers")}
            </Link>
          ) : null}

          {showReseedCta(details) && details.poolType && onReseedPool ? (
            <button
              type="button"
              onClick={() => {
                onReseedPool(details.poolType!);
                onClose();
              }}
              className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0]"
            >
              {t("wheelBlocked.reseedPool")}
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
