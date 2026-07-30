type DepositSlipSubmitCounts = {
  createdCount?: number;
  submitted?: number;
  skippedDuplicateCount?: number;
  updatedCount?: number;
};

type DepositSlipSubmitTranslator = (
  key:
    | "depositSlipSubmitSuccess"
    | "depositSlipSubmitAdded"
    | "depositSlipSubmitSkippedDuplicates",
  values?: { count: number },
) => string;

export function formatDepositSlipSubmitSuccessMessage(
  t: DepositSlipSubmitTranslator,
  data: DepositSlipSubmitCounts,
): string {
  const created = data.createdCount ?? data.submitted ?? 0;
  const updated = data.updatedCount ?? 0;
  const skipped = data.skippedDuplicateCount ?? 0;

  if (created === 0 && updated > 0) {
    return [
      t("depositSlipSubmitSuccess", { count: updated }),
      skipped > 0
        ? t("depositSlipSubmitSkippedDuplicates", { count: skipped })
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    t("depositSlipSubmitAdded", { count: created }),
    skipped > 0
      ? t("depositSlipSubmitSkippedDuplicates", { count: skipped })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
