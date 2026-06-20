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

import {
  computeCarouselTrim,
  WEEK_CAROUSEL_EDGE_THRESHOLD,
  WEEK_CAROUSEL_TRIM_DAYS,
} from "@/lib/client/week-schedule-carousel-window";
import { buildProvisionalWeekPage } from "@/lib/client/week-schedule-provisional";
import type { WeekTemplateType } from "@/lib/trains/types";

export type WeekCarouselDayEntry = {
  day: WeekScheduleDayConfig;
  weekStart: string;
  weekEnd: string;
  record: WeekConductorRecordSummary | undefined;
};

const EDGE_THRESHOLD = WEEK_CAROUSEL_EDGE_THRESHOLD;

function templateTypeForWeek(
  weekStart: string,
  cache: Map<string, WeekSchedulePagePayload>,
): WeekTemplateType {
  const cached = cache.get(weekStart);
  if (cached?.templateType) return cached.templateType;
  const prev = cache.get(addCalendarDays(weekStart, -7));
  if (prev?.templateType) return prev.templateType;
  const next = cache.get(addCalendarDays(weekStart, 7));
  if (next?.templateType) return next.templateType;
  return "vs_push_week";
}

function provisionalWeekFromCache(
  weekStart: string,
  cache: Map<string, WeekSchedulePagePayload>,
): WeekSchedulePagePayload {
  return buildProvisionalWeekPage(weekStart, templateTypeForWeek(weekStart, cache));
}

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

function indexForDateInEntries(
  entries: WeekCarouselDayEntry[],
  date: string,
): number {
  return entries.findIndex((entry) => entry.day.date === date);
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
  const seedWeekStartRef = useRef(seedPage.weekStart);
  const [days, setDays] = useState<WeekCarouselDayEntry[]>(() =>
    flattenWeekPage(seedPage),
  );
  const [bootstrapping, setBootstrapping] = useState(true);
  const daysRef = useRef(days);

  useEffect(() => {
    daysRef.current = days;
  }, [days]);

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

  const commitDays = useCallback((next: WeekCarouselDayEntry[]) => {
    daysRef.current = next;
    setDays(next);
  }, []);

  useEffect(() => {
    rememberPage(seedPage);
  }, [rememberPage, seedPage]);

  useEffect(() => {
    seedWeekStartRef.current = seedPage.weekStart;
  }, [seedPage.weekStart]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setBootstrapping(true);
      rememberPage(seedPage);

      const anchorStart = seedWeekStartRef.current;
      const prevStart = addCalendarDays(anchorStart, -7);
      const nextStart = addCalendarDays(anchorStart, 7);

      await Promise.all([fetchWeek(prevStart), fetchWeek(nextStart)]);

      if (cancelled) return;

      const merged = rebuildFromRange(prevStart, nextStart);
      commitDays(merged.length > 0 ? merged : flattenWeekPage(seedPage));
      setBootstrapping(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [commitDays, fetchWeek, rebuildFromRange, rememberPage, seedPage.weekStart]);

  const extendEarlier = useCallback(async (): Promise<number> => {
    const current = daysRef.current;
    const first = current[0];
    if (!first) return 0;

    const prevStart = addCalendarDays(first.weekStart, -7);
    if (!cacheRef.current.has(prevStart)) {
      rememberPage(provisionalWeekFromCache(prevStart, cacheRef.current));
    }

    const oldLength = current.length;
    const merged = rebuildFromRange(prevStart, current[current.length - 1]!.weekStart);
    if (merged.length <= oldLength) return 0;

    commitDays(merged);
    const prepended = merged.length - oldLength;

    void fetchWeek(prevStart).then((page) => {
      if (!page) return;
      rememberPage(page);
      const end = daysRef.current[daysRef.current.length - 1]?.weekStart;
      if (!end) return;
      const next = rebuildFromRange(prevStart, end);
      if (next.length > 0) commitDays(next);
    });

    return prepended;
  }, [commitDays, fetchWeek, rebuildFromRange, rememberPage]);

  const extendLater = useCallback(async () => {
    const current = daysRef.current;
    const last = current[current.length - 1];
    if (!last) return;

    const nextStart = addCalendarDays(last.weekStart, 7);
    if (!cacheRef.current.has(nextStart)) {
      rememberPage(provisionalWeekFromCache(nextStart, cacheRef.current));
    }

    const merged = rebuildFromRange(current[0]!.weekStart, nextStart);
    if (merged.length > current.length) {
      commitDays(merged);
    }

    void fetchWeek(nextStart).then((page) => {
      if (!page) return;
      rememberPage(page);
      const start = daysRef.current[0]?.weekStart;
      if (!start) return;
      const next = rebuildFromRange(start, nextStart);
      if (next.length > 0) commitDays(next);
    });
  }, [commitDays, fetchWeek, rebuildFromRange, rememberPage]);

  const bufferOpRef = useRef(Promise.resolve());

  const resolveIndexForDate = useCallback((date: string) => {
    return indexForDateInEntries(daysRef.current, date);
  }, []);

  const trimWindow = useCallback(
    (anchorDate: string, shiftPosition: (delta: number) => void) => {
      const current = daysRef.current;
      const anchorIndex = indexForDateInEntries(current, anchorDate);
      if (anchorIndex < 0) return;

      const plan = computeCarouselTrim(current.length, anchorIndex);
      if (!plan) return;

      if (plan.shiftDelta !== 0) {
        shiftPosition(plan.shiftDelta);
      }

      const next = plan.trimFromStart
        ? current.slice(WEEK_CAROUSEL_TRIM_DAYS)
        : current.slice(0, current.length - WEEK_CAROUSEL_TRIM_DAYS);
      commitDays(next);
    },
    [commitDays],
  );

  const ensureBuffer = useCallback(
    async (
      anchorDate: string,
      shiftPosition: (delta: number) => void,
    ): Promise<number> => {
      if (bootstrapping || daysRef.current.length === 0) {
        return resolveIndexForDate(anchorDate);
      }

      let anchorIndex = resolveIndexForDate(anchorDate);
      if (anchorIndex < 0) return -1;

      if (anchorIndex <= EDGE_THRESHOLD) {
        const prepended = await extendEarlier();
        if (prepended > 0) {
          shiftPosition(prepended);
          anchorIndex = resolveIndexForDate(anchorDate);
        }
      }

      anchorIndex = resolveIndexForDate(anchorDate);
      if (anchorIndex < 0) return -1;

      if (anchorIndex >= daysRef.current.length - 1 - EDGE_THRESHOLD) {
        await extendLater();
        anchorIndex = resolveIndexForDate(anchorDate);
      }

      trimWindow(anchorDate, shiftPosition);
      return resolveIndexForDate(anchorDate);
    },
    [
      bootstrapping,
      extendEarlier,
      extendLater,
      resolveIndexForDate,
      trimWindow,
    ],
  );

  const ensureBufferSerialized = useCallback(
    (anchorDate: string, shiftPosition: (delta: number) => void) => {
      const run = bufferOpRef.current.then(() =>
        ensureBuffer(anchorDate, shiftPosition),
      );
      bufferOpRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [ensureBuffer],
  );

  const ensureDateInBuffer = useCallback(
    async (date: string): Promise<number> => {
      const existingIndex = resolveIndexForDate(date);
      if (existingIndex >= 0) return existingIndex;

      const current = daysRef.current;
      const first = current[0];
      const last = current[current.length - 1];
      if (!first || !last) return -1;

      const weekStart = getWeekStartMonday(date);
      if (!cacheRef.current.has(weekStart)) {
        rememberPage(provisionalWeekFromCache(weekStart, cacheRef.current));
      }

      let startWeek = first.weekStart;
      let endWeek = last.weekStart;

      if (date < first.day.date) {
        startWeek = weekStart;
        for (
          let cursor = addCalendarDays(first.weekStart, -7);
          cursor >= startWeek;
          cursor = addCalendarDays(cursor, -7)
        ) {
          if (!cacheRef.current.has(cursor)) {
            rememberPage(provisionalWeekFromCache(cursor, cacheRef.current));
          }
        }
      } else if (date > last.day.date) {
        endWeek = weekStart;
        for (
          let cursor = addCalendarDays(last.weekStart, 7);
          cursor <= endWeek;
          cursor = addCalendarDays(cursor, 7)
        ) {
          if (!cacheRef.current.has(cursor)) {
            rememberPage(provisionalWeekFromCache(cursor, cacheRef.current));
          }
        }
      }

      const merged = rebuildFromRange(startWeek, endWeek);
      if (merged.length > 0) {
        commitDays(merged.length >= daysRef.current.length ? merged : daysRef.current);
      }

      void fetchWeek(weekStart);

      return indexForDateInEntries(daysRef.current, date);
    },
    [commitDays, fetchWeek, rebuildFromRange, rememberPage, resolveIndexForDate],
  );

  const getPageForWeek = useCallback((weekStart: string) => {
    return cacheRef.current.get(weekStart) ?? null;
  }, []);

  return {
    days,
    bootstrapping,
    ensureBuffer: ensureBufferSerialized,
    ensureDateInBuffer,
    getPageForWeek,
    resolveIndexForDate,
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
