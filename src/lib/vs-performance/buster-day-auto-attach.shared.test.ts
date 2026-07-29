import { describe, expect, it } from "vitest";

import { resolveBusterDaySnapshotAttach } from "./buster-day-auto-attach.shared";

describe("resolveBusterDaySnapshotAttach", () => {
  it("attaches roster as pre on Friday", () => {
    expect(
      resolveBusterDaySnapshotAttach({
        scoreTargetId: "member-roster-video",
        serverDate: "2026-07-17", // Friday
      }),
    ).toEqual({
      kind: "pre",
      vsWeekMonday: "2026-07-13",
      jobField: "rosterJobId",
    });
  });

  it("attaches kills as post on Sunday", () => {
    expect(
      resolveBusterDaySnapshotAttach({
        scoreTargetId: "alliance-kills-video",
        serverDate: "2026-07-19", // Sunday
      }),
    ).toEqual({
      kind: "post",
      vsWeekMonday: "2026-07-13",
      jobField: "killsJobId",
    });
  });

  it("uses recordedDate over serverDate for week/kind", () => {
    expect(
      resolveBusterDaySnapshotAttach({
        scoreTargetId: "member-roster-video",
        serverDate: "2026-07-20", // Monday
        recordedDate: "2026-07-17", // prior Friday
      }),
    ).toEqual({
      kind: "pre",
      vsWeekMonday: "2026-07-13",
      jobField: "rosterJobId",
    });
  });

  it("skips non-snapshot weekdays and unrelated targets", () => {
    expect(
      resolveBusterDaySnapshotAttach({
        scoreTargetId: "member-roster-video",
        serverDate: "2026-07-18", // Saturday
      }),
    ).toBeNull();
    expect(
      resolveBusterDaySnapshotAttach({
        scoreTargetId: "vs-performance",
        serverDate: "2026-07-17",
      }),
    ).toBeNull();
  });
});
