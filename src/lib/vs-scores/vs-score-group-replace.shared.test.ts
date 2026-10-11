import { describe, expect, it } from "vitest";
import {
  replaceSourceJobIdsForVsCommit,
  shouldClearVsHeadOnGroupReplace,
} from "./vs-score-group-replace.shared";

describe("replaceSourceJobIdsForVsCommit", () => {
  it("replaces only the committing job when there is no upload group", () => {
    expect(
      replaceSourceJobIdsForVsCommit({
        jobId: "job-a",
        groupId: null,
        siblingJobIds: ["job-b"],
      }),
    ).toEqual(["job-a"]);
  });

  it("includes every sibling pass when the job belongs to a group", () => {
    expect(
      replaceSourceJobIdsForVsCommit({
        jobId: "job-b",
        groupId: "group-1",
        siblingJobIds: ["job-a", "job-b", "job-c"],
      }).sort(),
    ).toEqual(["job-a", "job-b", "job-c"]);
  });
});

describe("shouldClearVsHeadOnGroupReplace", () => {
  const replaceJobIds = ["job-a", "job-b"];

  it("clears the committing job's prior heads on any date (date-move support)", () => {
    expect(
      shouldClearVsHeadOnGroupReplace({
        head: {
          sourceJobId: "job-b",
          recordedDate: "2026-08-31",
          period: "daily",
        },
        commitJobId: "job-b",
        commitRecordedDate: "2026-09-01",
        commitPeriod: "daily",
        replaceJobIds,
      }),
    ).toBe(true);
  });

  it("clears a sibling pass head on the same date+period being replaced", () => {
    // Pre-fix: commit filtered old heads by sourceJobId === input.jobId only,
    // so job-a's Monday members stayed live after job-b submitted a smaller set.
    expect(
      shouldClearVsHeadOnGroupReplace({
        head: {
          sourceJobId: "job-a",
          recordedDate: "2026-08-31",
          period: "daily",
        },
        commitJobId: "job-b",
        commitRecordedDate: "2026-08-31",
        commitPeriod: "daily",
        replaceJobIds,
      }),
    ).toBe(true);
  });

  it("does not clear a sibling pass head on a different date", () => {
    expect(
      shouldClearVsHeadOnGroupReplace({
        head: {
          sourceJobId: "job-a",
          recordedDate: "2026-09-01",
          period: "daily",
        },
        commitJobId: "job-b",
        commitRecordedDate: "2026-08-31",
        commitPeriod: "daily",
        replaceJobIds,
      }),
    ).toBe(false);
  });

  it("does not clear heads from jobs outside the replace set", () => {
    expect(
      shouldClearVsHeadOnGroupReplace({
        head: {
          sourceJobId: "job-other",
          recordedDate: "2026-08-31",
          period: "daily",
        },
        commitJobId: "job-b",
        commitRecordedDate: "2026-08-31",
        commitPeriod: "daily",
        replaceJobIds,
      }),
    ).toBe(false);
  });

  it("documents the hybrid-roster bug when only the selected job is considered", () => {
    const heads = [
      { memberId: "m1", sourceJobId: "job-a", recordedDate: "2026-08-31", period: "daily", score: 100 },
      { memberId: "m2", sourceJobId: "job-a", recordedDate: "2026-08-31", period: "daily", score: 200 },
      { memberId: "m1", sourceJobId: "job-b", recordedDate: "2026-08-31", period: "daily", score: 110 },
    ];
    const incoming = new Set(["m1"]);
    const buggyJobId = "job-b";
    const buggyCleared = heads.filter(
      (head) =>
        head.sourceJobId === buggyJobId && !incoming.has(head.memberId),
    );
    expect(buggyCleared).toEqual([]);
    // m2 from job-a would remain — hybrid roster after intentional replace.
    expect(
      heads.filter(
        (head) =>
          head.score != null &&
          !incoming.has(head.memberId) &&
          !buggyCleared.includes(head),
      ).map((head) => head.memberId),
    ).toEqual(["m2"]);

    const replaceJobIdsForGroup = replaceSourceJobIdsForVsCommit({
      jobId: "job-b",
      groupId: "group-1",
      siblingJobIds: ["job-a", "job-b"],
    });
    const fixedCleared = heads.filter(
      (head) =>
        shouldClearVsHeadOnGroupReplace({
          head,
          commitJobId: "job-b",
          commitRecordedDate: "2026-08-31",
          commitPeriod: "daily",
          replaceJobIds: replaceJobIdsForGroup,
        }) && !incoming.has(head.memberId),
    );
    expect(fixedCleared.map((head) => head.memberId)).toEqual(["m2"]);
  });
});
