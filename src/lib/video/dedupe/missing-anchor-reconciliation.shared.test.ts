import { describe, expect, it } from "vitest";

import { reconcileMissingAnchorRows } from "@/lib/video/dedupe/missing-anchor-reconciliation.shared";

type Row = { id: string; name: string; amount: number | null };

function isCompatible(rows: readonly Row[]): boolean {
  const amounts = new Set(
    rows.map((r) => r.amount).filter((a): a is number => a != null),
  );
  return amounts.size <= 1;
}

describe("reconcileMissingAnchorRows", () => {
  it("folds a single anchor-less row into its matching destination", () => {
    const anchorless: Row[] = [{ id: "a1", name: "EagleTN", amount: 6000 }];
    const destinations: Row[] = [{ id: "d1", name: "EagleTN", amount: 6000 }];

    const result = reconcileMissingAnchorRows(anchorless, destinations, {
      getName: (r) => r.name,
      isCompatible,
    });

    expect(result.mergedIntoDestination).toHaveLength(1);
    expect(result.mergedIntoDestination[0]?.destination.id).toBe("d1");
    expect(result.mergedIntoDestination[0]?.anchorlessRows.map((r) => r.id)).toEqual([
      "a1",
    ]);
    expect(result.mergedAmongThemselves).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.untouched).toHaveLength(0);
  });

  it("merges multiple anchor-less duplicates of the same commander with each other when no destination matches", () => {
    const anchorless: Row[] = [
      { id: "a1", name: "EagleTN", amount: 6000 },
      { id: "a2", name: "EagleTN", amount: 6000 },
      { id: "a3", name: "EagleTN", amount: 6000 },
    ];

    const result = reconcileMissingAnchorRows(anchorless, [], {
      getName: (r) => r.name,
      isCompatible,
    });

    expect(result.mergedAmongThemselves).toHaveLength(1);
    expect(result.mergedAmongThemselves[0]?.map((r) => r.id).sort()).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
    expect(result.mergedIntoDestination).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it("flags as ambiguous when the anchor-less row matches more than one destination", () => {
    const anchorless: Row[] = [{ id: "a1", name: "EagleTN", amount: 6000 }];
    const destinations: Row[] = [
      { id: "d1", name: "EagleTN", amount: 6000 },
      { id: "d2", name: "EagleTN", amount: 6000 },
    ];

    const result = reconcileMissingAnchorRows(anchorless, destinations, {
      getName: (r) => r.name,
      isCompatible,
    });

    expect(result.ambiguous).toHaveLength(1);
    expect(result.mergedIntoDestination).toHaveLength(0);
  });

  it("flags as ambiguous when the match has an incompatible field", () => {
    const anchorless: Row[] = [{ id: "a1", name: "EagleTN", amount: 5000 }];
    const destinations: Row[] = [{ id: "d1", name: "EagleTN", amount: 6000 }];

    const result = reconcileMissingAnchorRows(anchorless, destinations, {
      getName: (r) => r.name,
      isCompatible,
    });

    expect(result.ambiguous).toHaveLength(1);
    expect(result.mergedIntoDestination).toHaveLength(0);
  });

  it("leaves a row untouched when no name match exists anywhere", () => {
    const anchorless: Row[] = [{ id: "a1", name: "UniqueGuy", amount: 6000 }];
    const destinations: Row[] = [{ id: "d1", name: "EagleTN", amount: 6000 }];

    const result = reconcileMissingAnchorRows(anchorless, destinations, {
      getName: (r) => r.name,
      isCompatible,
    });

    expect(result.untouched.map((r) => r.id)).toEqual(["a1"]);
  });
});
