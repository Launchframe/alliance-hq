/**
 * Browser session ids (`alliance_hq_session` cookie values) stored on video
 * jobs must never be returned to clients. A designated processor who receives
 * another officer's session id can set that cookie and hijack the session.
 */

export type VideoJobSessionFields = {
  sessionId?: string | null;
  processingSessionId?: string | null;
};

/** Drop raw session cookie ids from a video-job-shaped object. */
export function omitVideoJobSessionIds<T extends VideoJobSessionFields>(
  job: T,
): Omit<T, "sessionId" | "processingSessionId"> {
  const { sessionId: _sessionId, processingSessionId: _processing, ...rest } =
    job;
  return rest;
}
