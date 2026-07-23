import { formatDepositSlipGameTimestamp } from "@/lib/banks/deposit-slip-ocr/deposit-slip-game-timestamp.shared";

export type DepositSlipReviewRowSummaryFields = {
  ocrName: string;
  allianceRankTitle?: string | null;
  score?: string | null;
  memberLevel?: number | null;
  powerLevel?: string | null;
  profession?: string | null;
};

const EM_DASH = "—";

/** Live review row one-liner: commander · tag · amount · term · depositAt · status */
export function formatDepositSlipReviewRowSummary(
  row: DepositSlipReviewRowSummaryFields,
): string {
  const commander = row.ocrName?.trim() || EM_DASH;
  const tag = row.allianceRankTitle?.trim() || EM_DASH;
  const amount = row.score?.trim() || EM_DASH;
  const term =
    row.memberLevel != null && Number.isFinite(row.memberLevel)
      ? `${row.memberLevel}d`
      : EM_DASH;
  const depositAt = formatDepositSlipGameTimestamp(row.powerLevel);
  const status = row.profession?.trim() || EM_DASH;
  return `${commander} · ${tag} · ${amount} · ${term} · ${depositAt} · ${status}`;
}

type DiffableKey = keyof Pick<
  DepositSlipReviewRowSummaryFields,
  "ocrName" | "allianceRankTitle" | "score" | "memberLevel" | "powerLevel" | "profession"
>;

const DIFFABLE_KEYS: readonly DiffableKey[] = [
  "ocrName",
  "allianceRankTitle",
  "score",
  "memberLevel",
  "powerLevel",
  "profession",
];

function normalizedDiffValue(
  row: DepositSlipReviewRowSummaryFields,
  key: DiffableKey,
): string {
  switch (key) {
    case "ocrName":
      return row.ocrName?.trim().toLowerCase() ?? "";
    case "allianceRankTitle":
      return row.allianceRankTitle?.trim().toLowerCase() ?? "";
    case "score":
      return row.score?.trim() ?? "";
    case "memberLevel":
      return row.memberLevel != null ? String(row.memberLevel) : "";
    case "powerLevel":
      return row.powerLevel?.trim() ?? "";
    case "profession":
      return row.profession?.trim().toLowerCase() ?? "";
    default:
      return "";
  }
}

/** Field keys whose values disagree across the given rows (for bold emphasis). */
export function diffKeysForDepositSlipRows(
  rows: readonly DepositSlipReviewRowSummaryFields[],
): Set<string> {
  const diffKeys = new Set<string>();
  if (rows.length < 2) return diffKeys;

  for (const key of DIFFABLE_KEYS) {
    const distinct = new Set(
      rows.map((row) => normalizedDiffValue(row, key)).filter((v) => v !== ""),
    );
    if (distinct.size > 1) diffKeys.add(key);
  }
  return diffKeys;
}

export function depositSlipReviewRowSummaryParts(
  row: DepositSlipReviewRowSummaryFields,
  diffKeys: Set<string>,
): Array<{ key: string; text: string; differs: boolean }> {
  const commander = row.ocrName?.trim() || EM_DASH;
  const tag = row.allianceRankTitle?.trim() || EM_DASH;
  const amount = row.score?.trim() || EM_DASH;
  const term =
    row.memberLevel != null && Number.isFinite(row.memberLevel)
      ? `${row.memberLevel}d`
      : EM_DASH;
  const depositAt = formatDepositSlipGameTimestamp(row.powerLevel);
  const status = row.profession?.trim() || EM_DASH;

  return [
    { key: "ocrName", text: commander, differs: diffKeys.has("ocrName") },
    { key: "allianceRankTitle", text: tag, differs: diffKeys.has("allianceRankTitle") },
    { key: "score", text: amount, differs: diffKeys.has("score") },
    { key: "memberLevel", text: term, differs: diffKeys.has("memberLevel") },
    { key: "powerLevel", text: depositAt, differs: diffKeys.has("powerLevel") },
    { key: "profession", text: status, differs: diffKeys.has("profession") },
  ];
}
