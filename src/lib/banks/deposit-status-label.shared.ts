import { DEPOSIT_STATUSES, type DepositStatus } from "@/lib/banks/types.shared";

export function formatDepositStatusToken(
  raw: string,
  labelForStatus: (status: DepositStatus) => string,
): string {
  if ((DEPOSIT_STATUSES as readonly string[]).includes(raw)) {
    return labelForStatus(raw as DepositStatus);
  }
  return raw;
}
