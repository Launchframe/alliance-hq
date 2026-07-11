/**
 * Hybrid Ashed panes must stay native-only when the current HQ alliance has no
 * Ashed id — the iframe cannot mirror that HQ alliance context.
 */
export function allianceSupportsHybridAshedPane(
  ashedAllianceId: string | null | undefined,
): boolean {
  return Boolean(ashedAllianceId?.trim());
}
