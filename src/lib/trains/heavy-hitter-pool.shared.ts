/**
 * Price Is Freight routing used to be inferred from paint template strings
 * plus a Saturday weekday check. The rule states it directly:
 * `{ kind: "price_is_freight", board: "weekday" | "heavy_hitter" }`.
 */
export {
  conductorRuleAppliesMinimums,
  conductorRuleUsesPriceIsFreightRoll,
} from "@/lib/trains/rules/derive.shared";

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";

/** Max-ticket draw (legacy Saturday PIF / takedown week). */
export function isHeavyHitterBoardRule(
  rule: ConductorRule | null | undefined,
): boolean {
  return rule?.kind === "price_is_freight" && rule.board === "heavy_hitter";
}

/** Price Is Freight conductor rolls need the source day's VS scores. */
export function ruleUsesPriorDayVs(
  rule: ConductorRule | null | undefined,
): boolean {
  return rule?.kind === "price_is_freight" || rule?.kind === "vs_top_n";
}
