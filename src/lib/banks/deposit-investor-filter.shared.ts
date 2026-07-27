/** Whether falloff includes every investor tag or only the session alliance's own. */
export const DEPOSIT_FALLOFF_INVESTOR_FILTERS = ["all", "myAlliance"] as const;
export type DepositFalloffInvestorFilter =
  (typeof DEPOSIT_FALLOFF_INVESTOR_FILTERS)[number];

export function normalizeDepositAllianceTag(
  tag: string | null | undefined,
): string | null {
  if (tag == null) return null;
  const trimmed = tag.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export type DepositSlipInvestorIdentity = {
  depositAllianceTag: string | null;
  depositAllianceId: string | null;
};

export function depositSlipMatchesMyAlliance(
  slip: DepositSlipInvestorIdentity,
  context: { allianceId: string; allianceTag: string | null },
): boolean {
  const slipTag = normalizeDepositAllianceTag(slip.depositAllianceTag);
  const allianceTag = normalizeDepositAllianceTag(context.allianceTag);
  if (allianceTag && slipTag === allianceTag) return true;
  if (slip.depositAllianceId && slip.depositAllianceId === context.allianceId) {
    return true;
  }
  return false;
}

export function filterDepositSlipsByInvestor<T extends DepositSlipInvestorIdentity>(
  slips: readonly T[],
  filter: DepositFalloffInvestorFilter,
  context: { allianceId: string; allianceTag: string | null },
): T[] {
  if (filter === "all") return [...slips];
  return slips.filter((slip) => depositSlipMatchesMyAlliance(slip, context));
}

export function parseDepositFalloffInvestorFilterParam(
  raw: string | null,
): DepositFalloffInvestorFilter {
  if (raw === "myAlliance") return "myAlliance";
  return "all";
}
