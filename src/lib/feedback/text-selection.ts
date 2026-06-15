const MIN_SELECTION_LENGTH = 2;

const EXCLUDED_ANCESTOR_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "[contenteditable='true']",
  "[data-bug-report-screenshot-preview]",
  "[data-app-select-menu]",
  "[role='dialog']",
  "[role='listbox']",
].join(",");

export type SelectionAnchor = {
  top: number;
  left: number;
};

export function readAppShellTextSelection(): string | null {
  const sel = window.getSelection();
  const text = sel?.toString().trim() ?? "";
  if (text.length < MIN_SELECTION_LENGTH) return null;
  if (!sel?.rangeCount) return null;

  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const node = container instanceof Element ? container : container.parentElement;
  if (!node) return null;

  if (node.closest(EXCLUDED_ANCESTOR_SELECTOR)) return null;

  const shell = document.getElementById("hq-app-shell");
  if (shell && !shell.contains(node)) return null;

  return text;
}

export function selectionAnchorFromWindow(
  maxWidth = 384,
): SelectionAnchor | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    top: rect.bottom + 8,
    left: Math.min(rect.left, window.innerWidth - maxWidth),
  };
}

export function clearWindowSelection() {
  window.getSelection()?.removeAllRanges();
}
