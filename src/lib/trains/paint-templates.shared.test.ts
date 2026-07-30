import { describe, expect, it } from "vitest";

import {
  DAY_PAINT_TEMPLATES,
  PAINT_TEMPLATES,
} from "@/lib/trains/paint-templates.shared";
import { isCompositeWeekTemplate } from "@/lib/trains/week-template-registry.shared";

describe("DAY_PAINT_TEMPLATES", () => {
  it("excludes composite week templates", () => {
    for (const template of DAY_PAINT_TEMPLATES) {
      expect(isCompositeWeekTemplate(template)).toBe(false);
    }
    expect(DAY_PAINT_TEMPLATES).not.toContain("vs_push_week");
    expect(DAY_PAINT_TEMPLATES).not.toContain("price_is_right");
  });

  it("includes every non-composite paint template", () => {
    expect(DAY_PAINT_TEMPLATES).toEqual(
      PAINT_TEMPLATES.filter((template) => !isCompositeWeekTemplate(template)),
    );
  });
});
