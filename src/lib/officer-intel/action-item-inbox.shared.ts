export const OFFICER_ACTION_ITEM_DUE_INBOX_KIND =
  "officer_action_item_due" as const;

export function officerActionItemHref(actionItemId: string): string {
  return `/notes?view=tasks&task=${encodeURIComponent(actionItemId)}`;
}
