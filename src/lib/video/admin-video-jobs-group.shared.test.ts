import { describe, expect, it } from "vitest";

import {
  groupAdminVideoJobsForIndex,
  orderAdminVideoJobsForIndex,
} from "./admin-video-jobs-group.shared";

type Job = {
  id: string;
  groupId: string | null;
  passRole: string | null;
  passIndex: number | null;
  createdAt: string;
};

function job(
  id: string,
  opts: Partial<Omit<Job, "id">> & { createdAt?: string } = {},
): Job {
  return {
    id,
    groupId: opts.groupId ?? null,
    passRole: opts.passRole ?? null,
    passIndex: opts.passIndex ?? null,
    createdAt: opts.createdAt ?? "2026-07-17T12:00:00.000Z",
  };
}

describe("groupAdminVideoJobsForIndex", () => {
  it("keeps solo jobs as single-member groups in input order", () => {
    const a = job("a", { createdAt: "2026-07-17T12:02:00.000Z" });
    const b = job("b", { createdAt: "2026-07-17T12:01:00.000Z" });
    expect(groupAdminVideoJobsForIndex([a, b])).toEqual([
      { key: "a", groupId: null, jobs: [a] },
      { key: "b", groupId: null, jobs: [b] },
    ]);
  });

  it("clusters siblings even when interleaved with other jobs", () => {
    const primary = job("p", {
      groupId: "g1",
      passRole: "primary",
      passIndex: 0,
      createdAt: "2026-07-17T12:02:00.000Z",
    });
    const other = job("x", { createdAt: "2026-07-17T12:01:30.000Z" });
    const shadow = job("s", {
      groupId: "g1",
      passRole: "shadow",
      passIndex: 1,
      createdAt: "2026-07-17T12:01:00.000Z",
    });
    // Newest-first input with shadow appearing before primary would normally
    // split them — grouping must pull them together.
    const groups = groupAdminVideoJobsForIndex([primary, other, shadow]);
    expect(groups.map((g) => g.jobs.map((j) => j.id))).toEqual([
      ["p", "s"],
      ["x"],
    ]);
  });

  it("orders within a group: primary then shadow by passIndex", () => {
    const shadow2 = job("s2", {
      groupId: "g1",
      passRole: "shadow",
      passIndex: 2,
      createdAt: "2026-07-17T12:00:02.000Z",
    });
    const shadow1 = job("s1", {
      groupId: "g1",
      passRole: "shadow",
      passIndex: 1,
      createdAt: "2026-07-17T12:00:01.000Z",
    });
    const primary = job("p", {
      groupId: "g1",
      passRole: "primary",
      passIndex: 0,
      createdAt: "2026-07-17T12:00:00.000Z",
    });
    expect(
      orderAdminVideoJobsForIndex([shadow2, shadow1, primary]).map((j) => j.id),
    ).toEqual(["p", "s1", "s2"]);
  });

  it("treats null passRole like primary", () => {
    const legacy = job("p", {
      groupId: "g1",
      passRole: null,
      passIndex: 0,
      createdAt: "2026-07-17T12:01:00.000Z",
    });
    const shadow = job("s", {
      groupId: "g1",
      passRole: "shadow",
      passIndex: 1,
      createdAt: "2026-07-17T12:00:00.000Z",
    });
    expect(orderAdminVideoJobsForIndex([shadow, legacy]).map((j) => j.id)).toEqual(
      ["p", "s"],
    );
  });
});
