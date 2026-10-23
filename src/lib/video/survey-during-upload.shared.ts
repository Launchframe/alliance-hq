import { hasSurveyAnswers, type SurveyPayload } from "@/lib/video/survey";

/**
 * Survey answers can be ready before the upload job id exists (the officer
 * fills the survey while bytes are still sending). Hold the payload until the
 * job id arrives, and flush at most once.
 */
export type PendingSurveySave = {
  jobId: string | null;
  payload: SurveyPayload | null;
};

export function emptyPendingSurveySave(): PendingSurveySave {
  return { jobId: null, payload: null };
}

export function attachSurveyJob(
  pending: PendingSurveySave,
  jobId: string,
): { pending: PendingSurveySave; flush: SurveyPayload | null } {
  const flush =
    pending.payload && hasSurveyAnswers(pending.payload) ? pending.payload : null;
  return {
    pending: { jobId, payload: null },
    flush,
  };
}

export function queueSurveyPayload(
  pending: PendingSurveySave,
  payload: SurveyPayload | null,
): { pending: PendingSurveySave; flush: SurveyPayload | null } {
  if (!payload || !hasSurveyAnswers(payload)) {
    return { pending, flush: null };
  }
  if (pending.jobId) {
    return { pending, flush: payload };
  }
  return {
    pending: { jobId: null, payload },
    flush: null,
  };
}
