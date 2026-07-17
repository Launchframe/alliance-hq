export const BANK_LIFECYCLE_GUIDE_STEP_SLUGS = [
  "battle-planning",
  "create-banks",
  "record-deposit-video",
  "review-and-commit",
  "ongoing-ops",
  "abandon-drop",
] as const;

export type BankLifecycleGuideStepSlug =
  (typeof BANK_LIFECYCLE_GUIDE_STEP_SLUGS)[number];

export type BankLifecycleGuideStepDef = {
  /** Screenshot placeholder keys shown in order on the step page. */
  screenshotKeys?: string[];
  showTip?: boolean;
};

export const BANK_LIFECYCLE_GUIDE_STEPS: Record<
  BankLifecycleGuideStepSlug,
  BankLifecycleGuideStepDef
> = {
  "battle-planning": {},
  "create-banks": {
    screenshotKeys: ["cityListImport"],
    showTip: true,
  },
  "record-deposit-video": {
    screenshotKeys: ["bankInfoMenu", "addToFavorites", "depositSlipHistory"],
    showTip: true,
  },
  "review-and-commit": {},
  "ongoing-ops": {},
  "abandon-drop": {
    screenshotKeys: ["abandonDrop"],
    showTip: true,
  },
};

export const BANK_LIFECYCLE_GUIDE_SCREENSHOTS: Record<string, string> = {};

export function isBankLifecycleGuideStepSlug(
  value: string,
): value is BankLifecycleGuideStepSlug {
  return (BANK_LIFECYCLE_GUIDE_STEP_SLUGS as readonly string[]).includes(
    value,
  );
}

export function stepSlugToMessageKey(slug: string): string {
  return slug.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function getBankLifecycleGuideStep(
  stepSlug: string,
): BankLifecycleGuideStepDef | null {
  return isBankLifecycleGuideStepSlug(stepSlug)
    ? BANK_LIFECYCLE_GUIDE_STEPS[stepSlug]
    : null;
}

export function buildBankLifecycleGuidePath(
  locale?: string,
  step?: string,
): string {
  const localePrefix = !locale || locale === "en-US" ? "" : `/${locale}`;
  let path = `${localePrefix}/guides/bank-lifecycle`;
  if (step) {
    path += `/${step}`;
  }
  return path;
}
