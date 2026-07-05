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

/**
 * Session-scoped access that respects HQ attribution. Legacy viewers (no HQ user)
 * keep session-only access; authenticated viewers only inherit session jobs that
 * are unattributed or owned by their HQ user (avoids leaks on reused browser sessions).
 */
export function isVideoJobAccessibleViaSession(
  sessionId: string,
  sessionHqUserId: string | null | undefined,
  job: {
    sessionId: string;
    hqUserId?: string | null;
    enqueuedByHqUserId?: string | null;
  },
): boolean {
  if (job.sessionId !== sessionId) {
    return false;
  }
  if (!sessionHqUserId) {
    return true;
  }
  if (!job.enqueuedByHqUserId && !job.hqUserId) {
    return true;
  }
  return isVideoJobOwningHqUser(sessionHqUserId, job);
}

/** Owner fields for SSE payloads so other devices for the same HQ user receive events. */
export function videoJobStatusOwnerFields(job: {
  sessionId: string;
  hqUserId?: string | null;
  enqueuedByHqUserId?: string | null;
}): {
  sessionId: string;
  hqUserId: string | null;
  enqueuedByHqUserId: string | null;
} {
  return {
    sessionId: job.sessionId,
    hqUserId: job.hqUserId ?? null,
    enqueuedByHqUserId: job.enqueuedByHqUserId ?? null,
  };
}

/**
 * Whether a live/snapshot status event belongs to this browser session or HQ
 * user (cross-device upload list and banners).
 */
export function isVideoJobStatusEventForViewer(
  event: {
    sessionId: string;
    hqUserId?: string | null;
    enqueuedByHqUserId?: string | null;
  },
  sessionId: string,
  hqUserId: string | null | undefined,
): boolean {
  if (isVideoJobOwningHqUser(hqUserId, event)) {
    return true;
  }
  return isVideoJobAccessibleViaSession(sessionId, hqUserId, event);
}
