import { describe, expect, it } from "vitest";
import { filterOfficerWorkQueueItems, isOfficerWorkQueueKind, workQueueShowsEmpty, type TeamWorkDashboardItem } from "./work-dashboard.shared";

const item = (kind: TeamWorkDashboardItem["kind"], teamId: string | null): TeamWorkDashboardItem => ({
  id: `${kind}:${teamId ?? "none"}`,
  memberId: "member",
  kind,
  teamId,
  detail: { memberName: "Member", date: "2099-01-01" },
  href: "/vs-compliance",
  assigneeName: "Lead",
  leadName: "Lead",
  leadUnlinked: false,
  leadAway: false,
});

describe("officer work queue projection", () => {
  it("keeps coverage and VS items and drops other kinds", () => {
    expect(isOfficerWorkQueueKind("time_off")).toBe(false);
    expect(isOfficerWorkQueueKind("coverage")).toBe(true);
    const items = [item("coverage", "cedar"), item("vs", "harbor")];
    expect(filterOfficerWorkQueueItems(items).map((row) => row.kind)).toEqual(["coverage", "vs"]);
    expect(filterOfficerWorkQueueItems(items, { kind: "vs", team: "harbor" }).map((row) => row.id)).toEqual(["vs:harbor"]);
    expect(filterOfficerWorkQueueItems(items, { team: "missing" })).toEqual([]);
  });

  it("does not treat an unloaded queue as empty", () => {
    expect(workQueueShowsEmpty(false, 0)).toBe(false);
    expect(workQueueShowsEmpty(true, 0)).toBe(true);
    expect(workQueueShowsEmpty(true, 1)).toBe(false);
  });
});
