/** Inbox reminder kind for post-link onboarding reviews. */
export const ONBOARDING_REVIEW_INBOX_KIND = "member_onboarding_review" as const;

export function onboardingReviewHref(reviewId: string): string {
  return `/members/onboarding-reviews?review=${encodeURIComponent(reviewId)}`;
}

export function resolveOnboardingReviewInboxHref(item: {
  kind: string;
  resourceId: string | null;
  href: string | null;
}): string | null {
  if (item.kind !== ONBOARDING_REVIEW_INBOX_KIND) {
    return item.href;
  }
  if (item.resourceId) {
    return onboardingReviewHref(item.resourceId);
  }
  return "/members/onboarding-reviews";
}
