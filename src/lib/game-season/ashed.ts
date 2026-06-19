import type { AshedAllianceRow } from "@/lib/alliance/types";

/** Ashed Alliance.server_number (float in API, e.g. 1203.0). */
export function parseAshedGameServerNumber(
  row: Pick<AshedAllianceRow, "server_number">,
): number | null {
  const raw = row.server_number;
  if (raw == null || raw === "") return null;
  const n =
    typeof raw === "number" ? Math.round(raw) : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
