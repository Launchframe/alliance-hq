import { describe, expect, it } from "vitest";

import {
  assertRollAllowed,
  assertTemplateChangeAllowed,
  TrainPastDateError,
} from "@/lib/trains/service";

describe("train service day guards", () => {
  const today = "2026-06-15";

  it("assertRollAllowed rejects past dates", () => {
    expect(() => assertRollAllowed("2026-06-14", today)).toThrow(
      TrainPastDateError,
    );
    expect(() => assertRollAllowed(today, today)).not.toThrow();
  });

  it("assertTemplateChangeAllowed rejects past dates for officers", () => {
    expect(() =>
      assertTemplateChangeAllowed("2026-06-14", false, today),
    ).toThrow(TrainPastDateError);
    expect(() =>
      assertTemplateChangeAllowed("2026-06-16", false, today),
    ).not.toThrow();
  });

  it("assertTemplateChangeAllowed allows platform admin past override", () => {
    expect(() =>
      assertTemplateChangeAllowed("2026-06-01", true, today),
    ).not.toThrow();
  });
});
