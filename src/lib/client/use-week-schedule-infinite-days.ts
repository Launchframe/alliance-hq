"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  WeekConductorRecordSummary,
  WeekScheduleDayConfig,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import {
  addCalendarDays,
  getWeekStartMonday,
} from "@/lib/trains/game-time";

export type WeekCarouselDayEntry = {
  day: WeekScheduleDayConfig;
  weekStart: string;
  weekEnd: string;
  record: WeekConductorRecordSummary | undefined;
};

const EDGE_THRESHOLD = 2;
const MAX_CAROUSEL_DAYS = 42;
const TRIM_DAYS = 7;

function flattenWeekPage(page: WeekSchedulePagePayload): WeekCarouselDayEntry[] {
  const recordByDate = new Map(
    page.weekRecords.map((record) => [record.date, record]),
  );
  return page.dayConfigs.map((day) => ({
    day,
    weekStart: page.weekStart,
    weekEnd: page.weekEnd,
    record: recordByDate.get(day.date),
  }));
}

function mergeWeekPages(
  pages: WeekSchedulePagePayload[],
): WeekCarouselDayEntry[] {
  const byDate = new Map<string, WeekCarouselDayEntry>();
  for (const page of pages) {
    for (const entry of flattenWeekPage(page)) {
      byDate.set(entry.day.date, entry);
    }
  }
  return [...byDate.values()].sort((a, b) => a.day.date.localeCompare(b.day.date));
}

function pagesFromCache(
  cache: Map<string, WeekSchedulePagePayload>,
  startWeek: string,
  endWeek: string,
): WeekSchedulePagePayload[] {
  const pages: WeekSchedulePagePayload[] = [];
  for (
    let cursor = startWeek;
    cursor <= endWeek;
    cursor = addCalendarDays(cursor, 7)
  ) {
    const page = cache.get(cursor);
    if (page) pages.push(page);
  }
  return pages;
}

type Options = {
  seedPage: WeekSchedulePagePayload;
  onWeekLoadError?: (message: string) => void;
};

export function useWeekScheduleInfiniteDays({
  seedPage,
  onWeekLoadError,
}: Options) {
  const cacheRef = useRef(new Map<string, WeekSchedulePagePayload>());
  const loadingWeeksRef = useRef(new Set<string>());
  const [days, setDays] = useState<WeekCarouselDayEntry[]>(() =>
    flattenWeekPage(seedPage),
  );
  const [bootstrapping, setBootstrapping] = useState(true);

  const rememberPage = useCallback((page: WeekSchedulePagePayload) => {
    cacheRef.current.set(page.weekStart, page);
  }, []);

  const fetchWeek = useCallback(
    async (weekStart: string): Promise<WeekSchedulePagePayload | null> => {
      const cached = cacheRef.current.get(weekStart);
      if (cached) return cached;

      if (loadingWeeksRef.current.has(weekStart)) {
        return null;
      }
      loadingWeeksRef.current.add(weekStart);

      try {
        const res = await fetch(
          `/api/trains/schedule/week?weekStart=${encodeURIComponent(weekStart)}`,
        );
        const body = (await res.json()) as WeekSchedulePagePayload & {
          error?: string;
        };
        if (!res.ok) {
          onWeekLoadError?.(body.error ?? "Could not load week.");
          return null;
        }
        rememberPage(body);
        return body;
      } catch {
        onWeekLoadError?.("Could not load week.");
        return null;
      } finally {
        loadingWeeksRef.current.delete(weekStart);
      }
    },
    [onWeekLoadError, rememberPage],
  );

  const rebuildFromRange = useCallback((startWeek: string, endWeek: string) => {
    const pages = pagesFromCache(cacheRef.current, startWeek, endWeek);
    if (pages.length === 0) return [];
    return mergeWeekPages(pages);
  }, []);

  useEffect(() => {
    rememberPage(seedPage);
  }, [rememberPage, seedPage]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setBootstrapping(true);
      rememberPage(seedPage);

      const anchorStart = seedPage.weekStart;
      const prevStart = addCalendarDays(anchorStart, -7);
      const nextStart = addCalendarDays(anchorStart, 7);

      await Promise.all([fetchWeek(prevStart), fetchWeek(nextStart)]);

      if (cancelled) return;

      const merged = rebuildFromRange(prevStart, nextStart);
      setDays(merged.length > 0 ? merged : flattenWeekPage(seedPage));
      setBootstrapping(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchWeek, rebuildFromRange, rememberPage, seedPage]);

  const extendEarlier = useCallback(async (): Promise<number> => {
    const first = days[0];
    if (!first) return 0;

    const prevStart = addCalendarDays(first.weekStart, -7);
    await fetchWeek(prevStart);
    if (!cacheRef.current.has(prevStart)) return 0;

    const oldLength = days.length;
    const merged = rebuildFromRange(prevStart, days[days.length - 1]!.weekStart);
    if (merged.length <= oldLength) return 0;

    setDays(merged);
    return merged.length - oldLength;
  }, [days, fetchWeek, rebuildFromRange]);

  const extendLater = useCallback(async () => {
    const last = days[days.length - 1];
    if (!last) return;

    const nextStart = addCalendarDays(last.weekStart, 7);
    await fetchWeek(nextStart);
    if (!cacheRef.current.has(nextStart)) return;

    const merged = rebuildFromRange(days[0]!.weekStart, nextStart);
    if (merged.length > days.length) {
      setDays(merged);
    }
  }, [days, fetchWeek, rebuildFromRange]);

  const trimWindow = useCallback(
    (focusedIndex: number, shiftPosition: (delta: number) => void) => {
      setDays((current) => {
        if (current.length <= MAX_CAROUSEL_DAYS) return current;

        if (focusedIndex > current.length / 2) {
          shiftPosition(-TRIM_DAYS);
          return current.slice(TRIM_DAYS);
        }

        return current.slice(0, current.length - TRIM_DAYS);
      });
    },
    [],
  );

  const ensureBuffer = useCallback(
    async (focusedIndex: number, shiftPosition: (delta: number) => void) => {
      if (bootstrapping || days.length === 0) return;

      if (focusedIndex <= EDGE_THRESHOLD) {
        const prepended = await extendEarlier();
        if (prepended > 0) {
          shiftPosition(prepended);
        }
      }

      if (focusedIndex >= days.length - 1 - EDGE_THRESHOLD) {
        await extendLater();
      }

      trimWindow(focusedIndex, shiftPosition);
    },
    [
      bootstrapping,
      days.length,
      extendEarlier,
      extendLater,
      trimWindow,
    ],
  );

  const loadAroundDate = useCallback(
    async (date: string) => {
      const weekStart = getWeekStartMonday(date);
      const prevStart = addCalendarDays(weekStart, -7);
      const nextStart = addCalendarDays(weekStart, 7);

      rememberPage(seedPage);
      await Promise.all([
        fetchWeek(prevStart),
        fetchWeek(weekStart),
        fetchWeek(nextStart),
      ]);

      const merged = rebuildFromRange(prevStart, nextStart);
      setDays(merged.length > 0 ? merged : flattenWeekPage(seedPage));
      return merged.findIndex((entry) => entry.day.date === date);
    },
    [fetchWeek, rebuildFromRange, rememberPage, seedPage],
  );

  const getPageForWeek = useCallback((weekStart: string) => {
    return cacheRef.current.get(weekStart) ?? null;
  }, []);

  return {
    days,
    bootstrapping,
    ensureBuffer,
    loadAroundDate,
    getPageForWeek,
    findIndexForDate: (date: string) =>
      days.findIndex((entry) => entry.day.date === date),
  };
}

export function weekRangeForDate(date: string): {
  weekStart: string;
  weekEnd: string;
} {
  const weekStart = getWeekStartMonday(date);
  return { weekStart, weekEnd: addCalendarDays(weekStart, 6) };
}
