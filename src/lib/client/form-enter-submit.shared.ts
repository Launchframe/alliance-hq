import type { FormEvent, KeyboardEvent } from "react";

/** Mobile keyboard label for primary submit on single-field / final-field inputs. */
export const FORM_SUBMIT_ENTER_KEY_HINT = "send" as const;

/** Use on `<form onSubmit>` when submit is handled in JS (not native navigation). */
export function preventDefaultFormSubmit(event: FormEvent): void {
  event.preventDefault();
}

/**
 * Textareas: Enter submits; Shift+Enter inserts a newline.
 * Skip when focus is inside `[data-no-enter-submit]`.
 */
export function handleTextareaEnterSubmit(
  event: KeyboardEvent,
  submit: () => void,
): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  if (event.nativeEvent.isComposing) return;
  const target = event.target;
  if (
    !target ||
    typeof (target as HTMLElement).closest !== "function"
  ) {
    return;
  }
  if ((target as HTMLElement).closest("[data-no-enter-submit]")) return;
  event.preventDefault();
  submit();
}
