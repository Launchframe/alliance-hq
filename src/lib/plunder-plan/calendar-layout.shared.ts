import { addCalendarDays } from "@/lib/trains/game-time";
import { isPlanDate, resolvePlanClock } from "./schedule.shared";

export function calendarDayBounds(date: string, zone: string): { start: number; end: number; minutes: number } | null {
  if (!isPlanDate(date)) return null;
  const firstClock = (day: string) => {
    for (let minute = 0; minute < 1440; minute += 15) {
      const value = resolvePlanClock(day, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, zone);
      if (value) return Date.parse(value);
    }
    return null;
  };
  const start = firstClock(date);
  let end = firstClock(addCalendarDays(date, 1));
  if (end === null) end = firstClock(addCalendarDays(date, 2));
  return start !== null && end !== null ? { start, end, minutes: (end - start) / 60_000 } : null;
}

export type CalendarEvent = { id: string; startAt: string; endAt: string };
export type CalendarSegment<T> = { event: T; startMinute: number; endMinute: number; continuesBefore: boolean; continuesAfter: boolean };
export type CalendarGroup<T> = { startMinute: number; endMinute: number; visible: Array<CalendarSegment<T> & { lane: number }>; overflow: CalendarSegment<T>[]; lanes: number };

export function calendarSegments<T extends CalendarEvent>(events: readonly T[], date: string, zone: string): CalendarSegment<T>[] {
  const bounds = calendarDayBounds(date, zone);
  if (!bounds) return [];
  const { start, end } = bounds;
  return events.flatMap((event) => {
    const a = Date.parse(event.startAt), b = Date.parse(event.endAt);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a >= end || b <= start) return [];
    const startMinute = (Math.max(start, a) - start) / 60_000;
    const endMinute = (Math.min(end, b) - start) / 60_000;
    return [{ event, startMinute, endMinute, continuesBefore: a < start, continuesAfter: b > end }];
  }).sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.event.id.localeCompare(b.event.id));
}

export function calendarGroups<T extends CalendarEvent>(segments: readonly CalendarSegment<T>[], maximumLanes = 3): CalendarGroup<T>[] {
  const limit = Math.max(1, Math.min(6, Math.floor(maximumLanes) || 1));
  const groups: CalendarGroup<T>[] = [];
  let laneEnds: number[] = [];
  for (const segment of [...segments].sort((a, b) => a.startMinute - b.startMinute || a.event.id.localeCompare(b.event.id))) {
    let group = groups[groups.length - 1];
    if (!group || segment.startMinute >= group.endMinute) {
      group = { startMinute: segment.startMinute, endMinute: segment.endMinute, visible: [], overflow: [], lanes: 0 };
      groups.push(group);
      laneEnds = [];
    }
    group.endMinute = Math.max(group.endMinute, segment.endMinute);
    const free = laneEnds.findIndex((end) => end <= segment.startMinute);
    const lane = free >= 0 ? free : laneEnds.length;
    if (lane >= limit) group.overflow.push(segment);
    else {
      laneEnds[lane] = segment.endMinute;
      group.visible.push({ ...segment, lane });
      group.lanes = Math.max(group.lanes, lane + 1);
    }
  }
  return groups;
}

export function swipeDayDelta(start: { x: number; y: number }, end: { x: number; y: number }): -1 | 0 | 1 {
  const dx = end.x - start.x, dy = end.y - start.y;
  return Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5 ? dx < 0 ? 1 : -1 : 0;
}
