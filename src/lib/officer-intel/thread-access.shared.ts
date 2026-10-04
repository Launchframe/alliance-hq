/** Continue an ask thread only when the requester owns it (or it is unowned). */
export function canContinueOfficerIntelThread(input: {
  createdByHqUserId: string | null;
  requesterHqUserId: string | null;
}): boolean {
  if (!input.requesterHqUserId) return false;
  if (input.createdByHqUserId == null) return true;
  return input.createdByHqUserId === input.requesterHqUserId;
}

/** Re-index RAG chunks for approve *and* later edits of an already-approved note. */
export function shouldIndexOfficerIntelNoteCorpus(input: {
  approve?: boolean;
  existingStatus: string;
}): boolean {
  return Boolean(input.approve) || input.existingStatus === "approved";
}
