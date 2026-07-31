import { describe, expect, it } from "vitest";

import {
  applyFrozenDepositSlipRowOrder,
  shouldKeepDepositSlipSortFrozenOnTbodyBlur,
} from "@/lib/banks/deposit-slip-review-sort-freeze.shared";

function mockDomNode(): Node {
  return { nodeType: 1 } as Node;
}

function mockDomElement(): Element {
  return { nodeType: 1 } as Element;
}

function mockTbody(contained: EventTarget[] = []): HTMLElement {
  const members = new Set(contained);
  return {
    contains(node: Node | null) {
      return node != null && members.has(node);
    },
  } as HTMLElement;
}

describe("applyFrozenDepositSlipRowOrder", () => {
  const rows = [
    { id: "a", powerLevel: "2026-07-25T21:10:00.000Z" },
    { id: "b", powerLevel: "2026-07-25T21:08:00.000Z" },
  ];

  it("returns sorted rows when not frozen", () => {
    expect(applyFrozenDepositSlipRowOrder(rows, null)).toEqual(rows);
  });

  it("preserves frozen order while row timestamps change", () => {
    const resorted = [
      { id: "b", powerLevel: "2026-07-25T21:08:00.000Z" },
      { id: "a", powerLevel: "2026-07-25T21:12:00.000Z" },
    ];
    expect(applyFrozenDepositSlipRowOrder(resorted, ["a", "b"])).toEqual([
      { id: "a", powerLevel: "2026-07-25T21:12:00.000Z" },
      { id: "b", powerLevel: "2026-07-25T21:08:00.000Z" },
    ]);
  });
});

describe("shouldKeepDepositSlipSortFrozenOnTbodyBlur", () => {
  it("keeps freeze when focus stays inside tbody via relatedTarget", () => {
    const input = mockDomNode();
    const tbody = mockTbody([input]);
    expect(
      shouldKeepDepositSlipSortFrozenOnTbodyBlur(tbody, input, mockDomElement()),
    ).toBe(true);
  });

  it("keeps freeze when activeElement returned to tbody after picker blur", () => {
    const input = mockDomElement();
    const tbody = mockTbody([input]);
    expect(
      shouldKeepDepositSlipSortFrozenOnTbodyBlur(tbody, null, input),
    ).toBe(true);
  });

  it("releases freeze when focus left the table", () => {
    const outside = mockDomElement();
    const tbody = mockTbody();
    expect(
      shouldKeepDepositSlipSortFrozenOnTbodyBlur(tbody, outside, outside),
    ).toBe(false);
  });

  it("does not throw when relatedTarget is not a Node (e.g. window)", () => {
    const tbody = mockTbody();
    const nonNodeTarget = { notANode: true } as unknown as EventTarget;
    expect(() =>
      shouldKeepDepositSlipSortFrozenOnTbodyBlur(tbody, nonNodeTarget, null),
    ).not.toThrow();
    expect(
      shouldKeepDepositSlipSortFrozenOnTbodyBlur(tbody, nonNodeTarget, null),
    ).toBe(false);
  });
});
