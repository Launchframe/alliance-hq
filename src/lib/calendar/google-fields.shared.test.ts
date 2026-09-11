import { describe, expect, it } from "vitest";
import { googleEventBody, googleEventMatches } from "./google-fields.shared";
import type { CalendarEvent } from "./types.shared";

const payload: CalendarEvent = { key: "boarding:record", source: "boarding", title: "Train Is Boarding", description: "", path: "/trains", start: "2026-09-10T12:00:00.000Z", end: "2026-09-10T15:55:00.000Z", allDay: false, alerts: [10, 1] };
const entry = { targetId: "target", uid: "opaque@hq.calendar", revision: 2, payload };
const options = { origin: "https://example.test", locale: "en-US", name: "Alliance HQ" };

describe("HQ-managed Google event fields", () => {
  it("sets two explicit popup alerts without calendar defaults or attendees", () => {
    const body = googleEventBody(entry, options);
    expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "popup", minutes: 1 }] });
    expect(body).not.toHaveProperty("attendees");
    expect(body.start).toEqual({ dateTime: payload.start });
  });
  it("disables defaults when alerts are Off", () => {
    expect(googleEventBody({ ...entry, payload: { ...payload, alerts: [] } }, options).reminders).toEqual({ useDefault: false, overrides: [] });
  });
  it("preserves date-only exclusive all-day boundaries", () => {
    const body = googleEventBody({ ...entry, payload: { ...payload, allDay: true, start: "2026-11-01", end: "2026-11-03" } }, options);
    expect(body.start).toEqual({ date: "2026-11-01" }); expect(body.end).toEqual({ date: "2026-11-03" });
  });
  it("recognizes equal instants and reordered reminders", () => {
    const body = googleEventBody(entry, options);
    expect(googleEventMatches({ ...body, start: { dateTime: "2026-09-10T10:00:00-02:00" }, reminders: { useDefault: false, overrides: [...body.reminders.overrides].reverse() } }, body)).toBe(true);
  });
  it("detects reminder-only edits without using the provider updated timestamp", () => {
    const body = googleEventBody(entry, options);
    expect(googleEventMatches({ ...body, reminders: { useDefault: true } }, body)).toBe(false);
  });
  it("does not consider another HQ target or a deleted event current", () => {
    const body = googleEventBody(entry, options);
    expect(googleEventMatches({ ...body, status: "cancelled" }, body)).toBe(false);
    expect(googleEventMatches({ ...body, extendedProperties: { private: { hqTarget: "other" } } }, body)).toBe(false);
  });
});
