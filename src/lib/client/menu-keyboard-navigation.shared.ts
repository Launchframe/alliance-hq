export type MenuItemRole =
  | "menuitem"
  | "menuitemradio"
  | "menuitemcheckbox";

const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

export function getMenuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)).filter(
    (item) =>
      !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true",
  );
}

export function getInitialMenuItemIndex(items: HTMLElement[]): number {
  const selectedIndex = items.findIndex(
    (item) => item.getAttribute("aria-checked") === "true",
  );
  return selectedIndex >= 0 ? selectedIndex : 0;
}

export function focusMenuItem(items: HTMLElement[], index: number): number {
  if (items.length === 0) return -1;
  const nextIndex = Math.max(0, Math.min(items.length - 1, index));
  items[nextIndex]?.focus();
  return nextIndex;
}

export type MenuKeyboardAction =
  | "next"
  | "previous"
  | "first"
  | "last"
  | "tab-forward"
  | "tab-backward";

export function menuKeyboardActionForKey(
  key: string,
  options?: { orientation?: "vertical" | "horizontal" },
): MenuKeyboardAction | null {
  const orientation = options?.orientation ?? "vertical";

  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "Tab") return "tab-forward";
  if (orientation === "vertical") {
    if (key === "ArrowDown") return "next";
    if (key === "ArrowUp") return "previous";
  } else {
    if (key === "ArrowRight") return "next";
    if (key === "ArrowLeft") return "previous";
  }
  return null;
}

export function nextMenuItemIndex(
  items: HTMLElement[],
  currentIndex: number,
  action: MenuKeyboardAction,
): number {
  if (items.length === 0) return -1;

  switch (action) {
    case "first":
      return 0;
    case "last":
      return items.length - 1;
    case "next":
      return (currentIndex + 1) % items.length;
    case "previous":
      return (currentIndex - 1 + items.length) % items.length;
    case "tab-forward":
      return currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
    case "tab-backward":
      return currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    default:
      return currentIndex;
  }
}
