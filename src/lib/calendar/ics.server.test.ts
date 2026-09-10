import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { serializeCalendar } from "./ics.server";
import type { CalendarEntry } from "./projection.server";

const entry: CalendarEntry = { targetId: "target", key: "source", uid: "stable@hq.calendar", fingerprint: "hash", revision: 3, cancelled: false, remoteId: null, remoteGeneration: 0, appliedRevision: 0, updatedAt: new Date("2026-09-10T12:00:00Z"), payload: { key: "source", source: "regular", title: "Exercício, amigos; juntos\nBEGIN:VEVENT", description: "é".repeat(100), path: "/trains", allDay: false, start: "2026-09-11T12:00:00.000Z", end: "2026-09-11T12:30:00.000Z", alerts: [10, 1] } };
const options = { name: "HQ calendar", origin: "https://example.test", locale: "pt-BR" };

describe("private calendar serialization", () => {
  it("round-trips text and two before-start alerts without injecting components", () => {
    const text = serializeCalendar([entry], options);
    const calendar = new ICAL.Component(ICAL.parse(text));
    const events = calendar.getAllSubcomponents("vevent");
    expect(events).toHaveLength(1);
    expect(events[0].getFirstPropertyValue("summary")).toBe(entry.payload.title);
    expect(events[0].getFirstPropertyValue("uid")).toBe(entry.uid);
    expect(events[0].getAllSubcomponents("valarm").map((alarm) => { const trigger = alarm.getFirstPropertyValue("trigger"); return trigger instanceof ICAL.Duration ? trigger.toSeconds() : null; })).toEqual([-600, -60]);
    expect(text.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });
  it("keeps output stable across fetches", () => {
    expect(serializeCalendar([entry], options)).toBe(serializeCalendar([entry], options));
  });
  it("uses date-based all-day boundaries, including DST days", () => {
    const text = serializeCalendar([{ ...entry, payload: { ...entry.payload, allDay: true, start: "2026-11-01", end: "2026-11-03" } }], options);
    const event = new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent("vevent")!;
    const start = event.getFirstPropertyValue("dtstart");
    expect(start instanceof ICAL.Time && start.isDate).toBe(true);
    expect(event.getFirstPropertyValue("dtend")?.toString()).toBe("2026-11-03");
  });
  it("withdraws cancelled events without retaining their content or alarms", () => {
    const text = serializeCalendar([{ ...entry, cancelled: true }], options);
    const event = new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent("vevent")!;
    expect(event.getFirstPropertyValue("status")).toBe("CANCELLED");
    expect(event.getAllSubcomponents("valarm")).toHaveLength(0);
    expect(text).not.toContain("amigos");
  });
});
