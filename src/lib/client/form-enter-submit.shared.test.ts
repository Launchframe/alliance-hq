import { describe, expect, it, vi } from "vitest";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
  preventDefaultFormSubmit,
} from "./form-enter-submit.shared";

describe("form-enter-submit.shared", () => {
  it("exports send enterKeyHint constant", () => {
    expect(FORM_SUBMIT_ENTER_KEY_HINT).toBe("send");
  });

  it("preventDefaultFormSubmit stops native navigation", () => {
    const event = { preventDefault: vi.fn() } as unknown as Parameters<
      typeof preventDefaultFormSubmit
    >[0];
    preventDefaultFormSubmit(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("handleTextareaEnterSubmit submits on Enter without Shift", () => {
    const submit = vi.fn();
    const preventDefault = vi.fn();
    const target = { closest: () => null } as unknown as HTMLElement;
    handleTextareaEnterSubmit(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false },
        target,
        preventDefault,
      } as unknown as Parameters<typeof handleTextareaEnterSubmit>[0],
      submit,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("handleTextareaEnterSubmit ignores Shift+Enter", () => {
    const submit = vi.fn();
    const target = { closest: () => null } as unknown as HTMLElement;
    handleTextareaEnterSubmit(
      {
        key: "Enter",
        shiftKey: true,
        nativeEvent: { isComposing: false },
        target,
        preventDefault: vi.fn(),
      } as unknown as Parameters<typeof handleTextareaEnterSubmit>[0],
      submit,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("handleTextareaEnterSubmit skips IME composition", () => {
    const submit = vi.fn();
    const target = { closest: () => null } as unknown as HTMLElement;
    handleTextareaEnterSubmit(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
        target,
        preventDefault: vi.fn(),
      } as unknown as Parameters<typeof handleTextareaEnterSubmit>[0],
      submit,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("handleTextareaEnterSubmit respects data-no-enter-submit wrapper", () => {
    const submit = vi.fn();
    const marker = {};
    const target = {
      closest: (selector: string) =>
        selector === "[data-no-enter-submit]" ? marker : null,
    } as unknown as HTMLElement;
    handleTextareaEnterSubmit(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false },
        target,
        preventDefault: vi.fn(),
      } as unknown as Parameters<typeof handleTextareaEnterSubmit>[0],
      submit,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("handleTextareaEnterSubmit ignores non-Enter keys", () => {
    const submit = vi.fn();
    const target = { closest: () => null } as unknown as HTMLElement;
    handleTextareaEnterSubmit(
      {
        key: "Escape",
        shiftKey: false,
        nativeEvent: { isComposing: false },
        target,
        preventDefault: vi.fn(),
      } as unknown as Parameters<typeof handleTextareaEnterSubmit>[0],
      submit,
    );
    expect(submit).not.toHaveBeenCalled();
  });
});
