import { isPastDropDeadline } from "@/lib/banks/optimization.shared";

export type BankLifecycleStage = "active" | "dropping_soon" | "abandoned";

export type BankLifecycleInput = {
  abandonedAt?: string | Date | null;
  dropByAt?: string | Date | null;
};

function dropByAtMs(dropByAt: string | Date): number {
  return dropByAt instanceof Date
    ? dropByAt.getTime()
    : Date.parse(String(dropByAt));
}

function dropByAtIso(
  dropByAt: string | Date | null | undefined,
): string | null {
  if (dropByAt == null) return null;
  return dropByAt instanceof Date ? dropByAt.toISOString() : String(dropByAt);
}

/**
 * Classify a bank for Bank Management tabs and drop recommendations.
 *
 * - **abandoned** — explicit `abandonedAt`, or legacy soft-archive via past `dropByAt`
 * - **dropping_soon** — future officer-planned `dropByAt`
 * - **active** — held with no drop deadline
 */
export function resolveBankLifecycleStage(
  bank: BankLifecycleInput,
  now: Date = new Date(),
): BankLifecycleStage {
  if (bank.abandonedAt != null) {
    return "abandoned";
  }
  if (isPastDropDeadline({ dropByAt: dropByAtIso(bank.dropByAt) }, now)) {
    return "abandoned";
  }
  if (bank.dropByAt != null) {
    const ms = dropByAtMs(bank.dropByAt);
    if (!Number.isNaN(ms) && ms > now.getTime()) {
      return "dropping_soon";
    }
  }
  return "active";
}
