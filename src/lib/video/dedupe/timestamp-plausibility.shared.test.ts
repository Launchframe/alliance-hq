import { describe, expect, it } from "vitest";

import { partitionPlausibleTimestamps } from "@/lib/video/dedupe/timestamp-plausibility.shared";

type Row = { id: string; ts: string | null };

function row(id: string, ts: string | null): Row {
  return { id, ts };
}

describe("partitionPlausibleTimestamps", () => {
  it("treats all rows as plausible when the batch is too small to trust a median", () => {
    const rows = [
      row("a", "2026-07-12T04:16:48.000Z"),
      row("b", "0256-07-12T04:16:48.000Z"),
    ];
    const { plausible, implausible } = partitionPlausibleTimestamps(
      rows,
      (r) => r.ts,
    );
    expect(plausible.map((r) => r.id)).toEqual(["a", "b"]);
    expect(implausible).toHaveLength(0);
  });

  it("flags a wildly-off-year outlier once there's a reliable batch median", () => {
    const rows = [
      row("a", "2026-07-12T00:00:00.000Z"),
      row("b", "2026-07-12T01:00:00.000Z"),
      row("c", "2026-07-12T02:00:00.000Z"),
      row("d", "2026-07-12T03:00:00.000Z"),
      row("e", "0256-07-12T04:16:48.000Z"),
    ];
    const { plausible, implausible } = partitionPlausibleTimestamps(
      rows,
      (r) => r.ts,
    );
    expect(plausible.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(implausible.map((r) => r.id)).toEqual(["e"]);
  });

  it("leaves rows spread across a multi-day capture window alone", () => {
    const rows = [
      row("a", "2026-07-10T00:00:00.000Z"),
      row("b", "2026-07-11T00:00:00.000Z"),
      row("c", "2026-07-12T00:00:00.000Z"),
      row("d", "2026-07-13T00:00:00.000Z"),
      row("e", "2026-07-14T00:00:00.000Z"),
    ];
    const { plausible, implausible } = partitionPlausibleTimestamps(
      rows,
      (r) => r.ts,
    );
    expect(plausible).toHaveLength(5);
    expect(implausible).toHaveLength(0);
  });

  it("passes rows with no timestamp through as plausible (caller handles them separately)", () => {
    const rows = [
      row("a", "2026-07-12T00:00:00.000Z"),
      row("b", "2026-07-12T01:00:00.000Z"),
      row("c", "2026-07-12T02:00:00.000Z"),
      row("d", "2026-07-12T03:00:00.000Z"),
      row("e", null),
    ];
    const { plausible, implausible } = partitionPlausibleTimestamps(
      rows,
      (r) => r.ts,
    );
    expect(plausible.map((r) => r.id)).toContain("e");
    expect(implausible).toHaveLength(0);
  });

  it("respects a custom maxDeviationMs", () => {
    const rows = [
      row("a", "2026-07-12T00:00:00.000Z"),
      row("b", "2026-07-12T00:10:00.000Z"),
      row("c", "2026-07-12T00:20:00.000Z"),
      row("d", "2026-07-12T00:30:00.000Z"),
      row("e", "2026-07-12T05:00:00.000Z"),
    ];
    const { plausible, implausible } = partitionPlausibleTimestamps(
      rows,
      (r) => r.ts,
      { maxDeviationMs: 60 * 60 * 1000 },
    );
    expect(implausible.map((r) => r.id)).toEqual(["e"]);
    expect(plausible).toHaveLength(4);
  });
});
