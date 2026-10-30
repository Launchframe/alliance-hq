import { describe, expect, it } from "vitest";

import type { SurveyPayload } from "@/lib/video/survey";
import {
  attachSurveyJob,
  emptyPendingSurveySave,
  queueSurveyPayload,
} from "@/lib/video/survey-during-upload.shared";

const answers: SurveyPayload = {
  rowCountEstimate: 80,
  scrollStyle: "slow_steady",
  aboveAverageScroll: true,
  schoolingTuitionAnswer: "yes",
};

describe("survey during upload", () => {
  it("holds answers until the job id exists, then flushes once", () => {
    const queued = queueSurveyPayload(emptyPendingSurveySave(), answers);
    expect(queued.flush).toBeNull();
    expect(queued.pending.payload).toEqual(answers);

    const attached = attachSurveyJob(queued.pending, "job-1");
    expect(attached.flush).toEqual(answers);
    expect(attached.pending).toEqual({ jobId: "job-1", payload: null });

    const again = queueSurveyPayload(attached.pending, answers);
    expect(again.flush).toEqual(answers);
    expect(again.pending.payload).toBeNull();
  });

  it("flushes immediately when the job already exists", () => {
    const attached = attachSurveyJob(emptyPendingSurveySave(), "job-1");
    expect(attached.flush).toBeNull();
    const queued = queueSurveyPayload(attached.pending, answers);
    expect(queued.flush).toEqual(answers);
    expect(queued.pending.jobId).toBe("job-1");
  });

  it("ignores an empty close", () => {
    const queued = queueSurveyPayload(emptyPendingSurveySave(), null);
    expect(queued.flush).toBeNull();
    expect(queued.pending.payload).toBeNull();
  });
});