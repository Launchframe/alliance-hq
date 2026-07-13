import {
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type DepositStatus,
  type DepositTermDays,
  type SerializedDepositSlip,
} from "@/lib/banks/types.shared";

/** Filter sentinel values (not alliance tags). */
export const DEPOSIT_ALLIANCE_FILTER_ALL = "all" as const;
export const DEPOSIT_ALLIANCE_FILTER_UNTAGGED = "untagged" as const;

export type DepositAllianceFilter =
  | typeof DEPOSIT_ALLIANCE_FILTER_ALL
  | typeof DEPOSIT_ALLIANCE_FILTER_UNTAGGED
  | string;

export type DepositCountAmount = {
  count: number;
  amount: number;
};

export type DepositAllianceSummary = {
  total: DepositCountAmount;
  byTerm: Record<DepositTermDays, DepositCountAmount>;
  byStatus: Record<DepositStatus, DepositCountAmount>;
};

function emptyCountAmount(): DepositCountAmount {
  return { count: 0, amount: 0 };
}

function normalizeTag(tag: string | null | undefined): string | null {
  if (tag == null) return null;
  const trimmed = tag.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Sorted distinct non-empty depositor alliance tags. */
export function uniqueDepositAllianceTags(
  slips: readonly Pick<SerializedDepositSlip, "depositAllianceTag">[],
): string[] {
  const tags = new Set<string>();
  for (const slip of slips) {
    const tag = normalizeTag(slip.depositAllianceTag);
    if (tag) tags.add(tag);
  }
  return [...tags].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function filterSlipsByDepositAlliance<
  T extends Pick<SerializedDepositSlip, "depositAllianceTag">,
>(slips: readonly T[], filter: DepositAllianceFilter): T[] {
  if (filter === DEPOSIT_ALLIANCE_FILTER_ALL) return [...slips];
  if (filter === DEPOSIT_ALLIANCE_FILTER_UNTAGGED) {
    return slips.filter((slip) => normalizeTag(slip.depositAllianceTag) == null);
  }
  const wanted = filter.trim().toLowerCase();
  return slips.filter(
    (slip) => normalizeTag(slip.depositAllianceTag)?.toLowerCase() === wanted,
  );
}

export function buildDepositAllianceSummary(
  slips: readonly Pick<SerializedDepositSlip, "termDays" | "status" | "amount">[],
): DepositAllianceSummary {
  const byTerm = Object.fromEntries(
    DEPOSIT_TERMS.map((term) => [term, emptyCountAmount()]),
  ) as Record<DepositTermDays, DepositCountAmount>;
  const byStatus = Object.fromEntries(
    DEPOSIT_STATUSES.map((status) => [status, emptyCountAmount()]),
  ) as Record<DepositStatus, DepositCountAmount>;
  const total = emptyCountAmount();

  for (const slip of slips) {
    total.count += 1;
    total.amount += slip.amount;
    const termBucket = byTerm[slip.termDays];
    if (termBucket) {
      termBucket.count += 1;
      termBucket.amount += slip.amount;
    }
    const statusBucket = byStatus[slip.status];
    if (statusBucket) {
      statusBucket.count += 1;
      statusBucket.amount += slip.amount;
    }
  }

  return { total, byTerm, byStatus };
}

export type FormatDepositAllianceReportInput = {
  bankLabel: string;
  allianceFilterLabel: string;
  slips: readonly SerializedDepositSlip[];
  summary: DepositAllianceSummary;
  statusLabel: (status: DepositStatus) => string;
  formatAmount?: (amount: number) => string;
  formatDateTime?: (iso: string) => string;
};

function defaultFormatAmount(amount: number): string {
  return amount.toLocaleString();
}

/**
 * Discord-friendly plain-text report for pasting (totals, term/status
 * breakdown, then a short per-slip list).
 */
export function formatDepositAllianceReportPlaintext(
  input: FormatDepositAllianceReportInput,
): string {
  const formatAmount = input.formatAmount ?? defaultFormatAmount;
  const formatDateTime = input.formatDateTime;
  const lines: string[] = [
    `Deposit report — ${input.bankLabel}`,
    `Alliance filter: ${input.allianceFilterLabel}`,
    "",
    `Totals: ${input.summary.total.count} deposits, ${formatAmount(input.summary.total.amount)} CrystalGold`,
    "",
    "By term:",
  ];

  for (const term of DEPOSIT_TERMS) {
    const bucket = input.summary.byTerm[term];
    lines.push(
      `  ${term}d — ${bucket.count} · ${formatAmount(bucket.amount)}`,
    );
  }

  lines.push("", "By status:");
  for (const status of DEPOSIT_STATUSES) {
    const bucket = input.summary.byStatus[status];
    lines.push(
      `  ${input.statusLabel(status)} — ${bucket.count} · ${formatAmount(bucket.amount)}`,
    );
  }

  if (input.slips.length > 0) {
    const sorted = [...input.slips].sort(
      (a, b) => new Date(a.depositAt).getTime() - new Date(b.depositAt).getTime(),
    );
    lines.push("", "Deposits:");
    for (const slip of sorted) {
      const tag = normalizeTag(slip.depositAllianceTag);
      const tagPart = tag ? ` [${tag}]` : "";
      const when = formatDateTime
        ? formatDateTime(slip.depositAt)
        : slip.depositAt;
      lines.push(
        `  ${formatAmount(slip.amount)} · ${slip.termDays}d · ${input.statusLabel(slip.status)} · ${slip.commanderName}${tagPart} · ${when}`,
      );
    }
  }

  return lines.join("\n");
}
