/** Client-safe ownership check for video job / upload group access. */
export function isVideoJobOwningHqUser(
  sessionHqUserId: string | null | undefined,
  job: {
    hqUserId?: string | null;
    enqueuedByHqUserId?: string | null;
  },
): boolean {
  if (!sessionHqUserId) {
    return false;
  }
  return (
    job.enqueuedByHqUserId === sessionHqUserId ||
    job.hqUserId === sessionHqUserId
  );
}
