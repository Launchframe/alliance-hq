import { describe, expect, it } from "vitest";

import {
  nextEurOccurrenceStart,
  pickEurSatisfyingJobId,
  type EurSatisfactionOccurrenceCandidate,
} from "./satisfaction-match.shared";

function occ(
  partial: Partial<EurSatisfactionOccurrenceCandidate> &
    Pick<EurSatisfactionOccurrenceCandidate, "id" | "scheduledStartAt">,
): EurSatisfactionOccurrenceCandidate {
  return {
    allianceId: "ally-1",
    scoreTarget: "warzone-duel",
    ...partial,
  };
}

describe("nextEurOccurrenceStart", () => {
  it("returns the next same-target start after this occurrence", () => {
    const mon = occ({
      id: "mon",
      scheduledStartAt: new Date("2026-06-22T02:15:00.000Z"),
    });
    const wed = occ({
      id: "wed",
      scheduledStartAt: new Date("2026-06-24T02:15:00.000Z"),
    });
    const fri = occ({
      id: "fri",
      scheduledStartAt: new Date("2026-06-26T02:15:00.000Z"),
    });
    expect(nextEurOccurrenceStart(mon, [mon, wed, fri])).toEqual(
      wed.scheduledStartAt,
    );
    expect(nextEurOccurrenceStart(wed, [mon, wed, fri])).toEqual(
      fri.scheduledStartAt,
    );
    expect(nextEurOccurrenceStart(fri, [mon, wed, fri])).toBeNull();
  });

  it("ignores other alliances and score targets", () => {
    const mon = occ({
      id: "mon",
      scheduledStartAt: new Date("2026-06-22T02:15:00.000Z"),
    });
    const otherAlly = occ({
      id: "other-ally",
      allianceId: "ally-2",
      scheduledStartAt: new Date("2026-06-23T02:15:00.000Z"),
    });
    const otherTarget = occ({
      id: "other-target",
      scoreTarget: "desert-storm",
      scheduledStartAt: new Date("2026-06-23T03:00:00.000Z"),
    });
    expect(nextEurOccurrenceStart(mon, [mon, otherAlly, otherTarget])).toBeNull();
  });
});

describe("pickEurSatisfyingJobId", () => {
  const monStart = new Date("2026-06-22T02:15:00.000Z");
  const wedStart = new Date("2026-06-24T02:15:00.000Z");

  it("binds one job to one occurrence window (later job does not clear earlier slot)", () => {
    const wedJob = {
      id: "job-wed",
      at: new Date("2026-06-24T04:00:00.000Z"),
    };
    // Monday's window ends at Wednesday start — Wednesday's upload is out of range.
    expect(
      pickEurSatisfyingJobId({
        occurrenceScheduledStartAt: monStart,
        nextOccurrenceScheduledStartAt: wedStart,
        candidateJobs: [wedJob],
        usedJobIds: new Set(),
      }),
    ).toBeNull();

    expect(
      pickEurSatisfyingJobId({
        occurrenceScheduledStartAt: wedStart,
        nextOccurrenceScheduledStartAt: null,
        candidateJobs: [wedJob],
        usedJobIds: new Set(),
      }),
    ).toBe("job-wed");
  });

  it("never reuses a job already claimed by an earlier occurrence", () => {
    const sharedJob = {
      id: "job-1",
      at: new Date("2026-06-25T12:00:00.000Z"),
    };
    // Without a next bound (lookahead not yet materializing the sibling),
    // the job is still eligible for Monday — but only once.
    expect(
      pickEurSatisfyingJobId({
        occurrenceScheduledStartAt: monStart,
        nextOccurrenceScheduledStartAt: null,
        candidateJobs: [sharedJob],
        usedJobIds: new Set(),
      }),
    ).toBe("job-1");

    expect(
      pickEurSatisfyingJobId({
        occurrenceScheduledStartAt: wedStart,
        nextOccurrenceScheduledStartAt: null,
        candidateJobs: [sharedJob],
        usedJobIds: new Set(["job-1"]),
      }),
    ).toBeNull();
  });

  it("prefers the earliest eligible unused job in the window", () => {
    expect(
      pickEurSatisfyingJobId({
        occurrenceScheduledStartAt: monStart,
        nextOccurrenceScheduledStartAt: wedStart,
        candidateJobs: [
          { id: "late", at: new Date("2026-06-23T20:00:00.000Z") },
          { id: "early", at: new Date("2026-06-22T03:00:00.000Z") },
          { id: "before", at: new Date("2026-06-21T12:00:00.000Z") },
        ],
        usedJobIds: new Set(),
      }),
    ).toBe("early");
  });
});
