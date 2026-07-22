import { describe, expect, it, vi } from "vitest";

import {
  focusMenuItem,
  getInitialMenuItemIndex,
  menuKeyboardActionForKey,
  nextMenuItemIndex,
} from "@/lib/client/menu-keyboard-navigation.shared";

function item(checked = false): HTMLElement {
  return {
    getAttribute: (name: string) =>
      checked && name === "aria-checked" ? "true" : null,
    focus: vi.fn(),
  } as unknown as HTMLElement;
}

describe("menu keyboard navigation", () => {
  it("prefers the checked menu item for initial focus", () => {
    const items = [item(), item(true), item()];
    expect(getInitialMenuItemIndex(items)).toBe(1);
  });

  it("maps vertical arrow keys to next and previous actions", () => {
    expect(menuKeyboardActionForKey("ArrowDown")).toBe("next");
    expect(menuKeyboardActionForKey("ArrowUp")).toBe("previous");
    expect(menuKeyboardActionForKey("Home")).toBe("first");
    expect(menuKeyboardActionForKey("End")).toBe("last");
  });

  it("wraps next and previous indices", () => {
    const items = [item(), item(), item()];
    expect(nextMenuItemIndex(items, 2, "next")).toBe(0);
    expect(nextMenuItemIndex(items, 0, "previous")).toBe(2);
  });

  it("focuses the requested item", () => {
    const items = [item(), item(), item()];
    const index = focusMenuItem(items, 2);
    expect(index).toBe(2);
    expect(items[2]?.focus).toHaveBeenCalledTimes(1);
  });
});
