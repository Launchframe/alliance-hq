/**
 * Cancel must not overwrite a confirm-capture that already completed
 * (or an event that is otherwise no longer scheduled).
 */
export function shouldRejectCancelOfNonScheduled(
  bodyStatus: string | undefined,
  existingStatus: string,
): boolean {
  return (bodyStatus ?? "scheduled") === "cancelled" && existingStatus !== "scheduled";
}
