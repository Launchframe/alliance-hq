/** Game-server wall clock for deposit-slip review summaries (24h, unpadded month/day). */
export function formatDepositSlipGameTimestamp(
  iso: string | null | undefined,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}
