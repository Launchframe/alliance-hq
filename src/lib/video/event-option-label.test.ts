import { describe, expect, it } from "vitest";

import {
  formatAshedEventOptionLabel,
  formatEventOptionLabel,
  formatHqEventOptionLabel,
  parseEventDateString,
  resolveAshedEventDate,
} from "@/lib/video/event-option-label";

describe("parseEventDateString", () => {
  it("parses YYYY-MM-DD", () => {
    const date = parseEventDateString("2026-06-11");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(5);
    expect(date?.getDate()).toBe(11);
  });
});

describe("formatEventOptionLabel", () => {
  it("formats en-US as MM/DD/YY", () => {
    expect(
      formatEventOptionLabel({
        eventTypeLabel: "Desert Storm",
        eventDate: "2026-06-11",
        locale: "en-US",
      }),
    ).toBe("Desert Storm 06/11/26");
  });

  it("formats pt-BR as DD/MM/YY", () => {
    expect(
      formatEventOptionLabel({
        eventTypeLabel: "Desert Storm",
        eventDate: "2026-06-11",
        locale: "pt-BR",
      }),
    ).toBe("Desert Storm 11/06/26");
  });

  it("returns type label when date is missing", () => {
    expect(
      formatEventOptionLabel({
        eventTypeLabel: "Desert Storm",
        eventDate: null,
        locale: "en-US",
      }),
    ).toBe("Desert Storm");
  });
});

describe("formatAshedEventOptionLabel", () => {
  it("prefers start_date", () => {
    expect(
      formatAshedEventOptionLabel({
        eventTypeLabel: "Desert Storm",
        event: {
          id: "CxZzjAkw9ALD9fcX",
          name: "CxZzjAkw9ALD9fcX",
          start_date: "2026-06-11",
        },
        locale: "en-US",
      }),
    ).toBe("Desert Storm 06/11/26");
  });
});

describe("formatHqEventOptionLabel", () => {
  it("uses startDate", () => {
    expect(
      formatHqEventOptionLabel({
        eventTypeLabel: "Frontline Breakthrough",
        event: {
          id: "hq1",
          name: "ignored",
          startDate: "2026-06-11",
        },
        locale: "en-US",
      }),
    ).toBe("Frontline Breakthrough 06/11/26");
  });
});

describe("resolveAshedEventDate", () => {
  it("falls back through known fields", () => {
    expect(
      resolveAshedEventDate({
        id: "1",
        end_date: "2026-06-12",
      }),
    ).toBe("2026-06-12");
  });
});
