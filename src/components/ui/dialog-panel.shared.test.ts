import { describe, expect, it } from "vitest";

import { dialogPanelClassName } from "./dialog-panel.shared";

describe("dialogPanelClassName", () => {
  it("applies default max width and height when caller omits overrides", () => {
    const className = dialogPanelClassName("");
    expect(className).toContain("max-w-lg");
    expect(className).toContain("max-h-[min(90vh,720px)]");
  });

  it("omits default max width when caller passes max-w-*", () => {
    const className = dialogPanelClassName("max-w-5xl");
    expect(className).not.toContain("max-w-lg");
    expect(className).toContain("max-w-5xl");
    expect(className).toContain("max-h-[min(90vh,720px)]");
  });

  it("omits default max height when caller passes max-h-*", () => {
    const className = dialogPanelClassName("max-h-[90vh]");
    expect(className).toContain("max-w-lg");
    expect(className).not.toContain("max-h-[min(90vh,720px)]");
    expect(className).toContain("max-h-[90vh]");
  });

  it("omits both defaults when caller passes max-w and max-h", () => {
    const className = dialogPanelClassName("min-h-[50vh] max-h-[90vh] max-w-3xl");
    expect(className).not.toContain("max-w-lg");
    expect(className).not.toContain("max-h-[min(90vh,720px)]");
    expect(className).toContain("min-h-[50vh]");
    expect(className).toContain("max-h-[90vh]");
    expect(className).toContain("max-w-3xl");
  });
});
