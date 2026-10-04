"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";

import { useShellActivityOptional } from "@/components/ashed-shell/ShellActivityProvider";
import { useAccountTimezone } from "@/components/timezone/TimezoneProvider";
import { activityDayStartIso } from "@/lib/activity/presentation.shared";
import {
  ACTIVITY_SCOPES,
  type ActivityFeedItem,
  type ActivityFeedOptions,
  type ActivityFeedOptionsResponse,
  type ActivityFeedPage,
  type ActivityFeedScope,
} from "@/lib/activity/feed.shared";
import { resolveAccountTimeZoneIana } from "@/lib/timezone/account";
import { addCalendarDays } from "@/lib/trains/game-time";

const ENDPOINTS: Record<ActivityFeedScope, string> = {
  personal: "/api/activity/personal",
  alliance: "/api/activity/alliance",
  global: "/api/admin/activity",
};

const PAGE_SIZE = 50;
const POLL_MS = 30_000;
const LOOKUP_DEBOUNCE_MS = 300;
const LOOKUP_FIELDS = ["actor", "alliance", "server"] as const;

export type ActivityFeedError = "loadFailed" | "accessChanged";
export type ActivityErrorPlacement = "toolbar" | "bottom";

export type ActivityFilterValues = {
  channel: string;
  kind: string;
  category: string;
  actor: string;
  allianceId: string;
  server: string;
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_ACTIVITY_FILTERS: ActivityFilterValues = {
  channel: "",
  kind: "",
  category: "",
  actor: "",
  allianceId: "",
  server: "",
  dateFrom: "",
  dateTo: "",
};

export type ActivityLookupField = "actor" | "alliance" | "server";

type AppliedFilters = {
  from?: string;
  to?: string;
  channel?: string;
  category?: string;
  kind?: string;
  actor?: string;
  allianceId?: string;
  server?: string;
};

type BusyKind = "first" | "more" | "refresh";

type FailedOperation =
  | { kind: "more"; cursor: string }
  | { kind: "first" };

class ActivityRequestError extends Error {
  constructor(
    readonly errorKey: ActivityFeedError,
    readonly status: number,
  ) {
    super(errorKey);
    this.name = "ActivityRequestError";
  }
}

async function responseError(res: Response): Promise<ActivityRequestError> {
  const body = (await res.json().catch(() => null)) as {
    errorKey?: string;
  } | null;
  let errorKey: ActivityFeedError =
    body?.errorKey === "activity.accessChanged" ? "accessChanged" : "loadFailed";
  if (res.status === 401 || res.status === 403) {
    errorKey = "accessChanged";
  }
  return new ActivityRequestError(errorKey, res.status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function knownActivityScopes(scopes: readonly string[]): ActivityFeedScope[] {
  const allowed = new Set(scopes);
  return ACTIVITY_SCOPES.filter((entry) => allowed.has(entry));
}

function headsEqual(
  a: { id: string; occurredAt: string } | null,
  b: { id: string; occurredAt: string } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.occurredAt === b.occurredAt;
}

function mergeUnique(
  existing: ActivityFeedItem[],
  incoming: ActivityFeedItem[],
): ActivityFeedItem[] {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

const EMPTY_LOOKUP_OPTIONS = {
  actor: [] as ActivityFeedOptions["actors"],
  alliance: [] as ActivityFeedOptions["alliances"],
  server: [] as string[],
};

const EMPTY_LOOKUP_ERRORS: Record<ActivityLookupField, boolean> = {
  actor: false,
  alliance: false,
  server: false,
};

export function useActivityFeed({
  scope,
  scopeFence,
  allowedScopes: initialAllowedScopes,
  initial,
  initialOptions,
  initialError,
}: {
  scope: ActivityFeedScope;
  scopeFence: string;
  allowedScopes: ActivityFeedScope[];
  initial: ActivityFeedPage | null;
  initialOptions: ActivityFeedOptionsResponse | null;
  initialError: ActivityFeedError | null;
}) {
  const locale = useLocale();
  const { timezoneId } = useAccountTimezone();
  const iana = resolveAccountTimeZoneIana(timezoneId);
  const shell = useShellActivityOptional();
  const blocked =
    shell?.activity.kind === "allianceSwitch" ||
    shell?.activity.kind === "sessionChange";

  const [rows, setRows] = useState<ActivityFeedItem[]>(initial?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initial?.nextCursor ?? null,
  );
  const [firstHead, setFirstHeadState] = useState<ActivityFeedPage["head"]>(
    initial?.head ?? null,
  );
  const [options, setOptions] = useState<ActivityFeedOptions | null>(
    initialOptions?.options ?? null,
  );
  const [allowedScopes, setAllowedScopes] = useState<ActivityFeedScope[]>(
    knownActivityScopes(initialAllowedScopes),
  );
  const [error, setError] = useState<ActivityFeedError | null>(initialError);
  const [errorPlacement, setErrorPlacement] =
    useState<ActivityErrorPlacement>("toolbar");
  const [busy, setBusy] = useState<BusyKind | null>(
    initial === null && initialError === null ? "first" : null,
  );
  const [pendingNew, setPendingNew] = useState(false);
  const [alertTick, setAlertTick] = useState(0);
  const [filters, setFilters] =
    useState<ActivityFilterValues>(EMPTY_ACTIVITY_FILTERS);
  const [lookupOptions, setLookupOptions] = useState({
    actor: initialOptions?.options.actors ?? [],
    alliance: initialOptions?.options.alliances ?? [],
    server: initialOptions?.options.servers ?? [],
  });
  const [lookupError, setLookupError] = useState<
    Record<ActivityLookupField, boolean>
  >(EMPTY_LOOKUP_ERRORS);
  const [lookupAlert, setLookupAlert] = useState<
    Record<ActivityLookupField, number>
  >({ actor: 0, alliance: 0, server: 0 });

  const generationRef = useRef(0);
  const headSeqRef = useRef(0);
  const pageAbortRef = useRef<AbortController | null>(null);
  const headAbortRef = useRef<AbortController | null>(null);
  const pageInFlightRef = useRef(false);
  const firstHeadRef = useRef(initial?.head ?? null);
  const appliedRef = useRef<AppliedFilters>({});
  const blockedRef = useRef(blocked);
  const errorRef = useRef<ActivityFeedError | null>(initialError);
  const failedOpRef = useRef<FailedOperation | null>(
    initialError ? { kind: "first" } : null,
  );
  const mountedRef = useRef(false);
  const filtersRef = useRef(filters);
  const filtersValidRef = useRef(true);
  const prevIanaRef = useRef(iana);

  const lookupSeqRef = useRef<Record<ActivityLookupField, number>>({
    actor: 0,
    alliance: 0,
    server: 0,
  });
  const lookupAbortRef = useRef<
    Record<ActivityLookupField, AbortController | null>
  >({ actor: null, alliance: null, server: null });
  const lookupTimerRef = useRef<
    Record<ActivityLookupField, ReturnType<typeof setTimeout> | null>
  >({ actor: null, alliance: null, server: null });
  const lookupQueryRef = useRef<Record<ActivityLookupField, string>>({
    actor: "",
    alliance: "",
    server: "",
  });
  const skipInitialLookupRef = useRef<Record<ActivityLookupField, boolean>>({
    actor: initialOptions !== null,
    alliance: initialOptions !== null,
    server: initialOptions !== null,
  });

  const requestHeaders = useMemo(
    () => ({
      "x-activity-scope": scopeFence,
      "x-activity-locale": locale,
    }),
    [scopeFence, locale],
  );

  const fetchJson = useCallback(
    async <Body>(params: URLSearchParams, signal: AbortSignal): Promise<Body> => {
      const res = await fetch(`${ENDPOINTS[scope]}?${params.toString()}`, {
        cache: "no-store",
        headers: requestHeaders,
        signal,
      });
      if (!res.ok) {
        throw await responseError(res);
      }
      return (await res.json()) as Body;
    },
    [scope, requestHeaders],
  );

  const responseAllowed = useCallback(
    (body: {
      scope: string;
      scopeFence: string;
      allowedScopes: ActivityFeedScope[];
    }) =>
      body.scope === scope &&
      body.scopeFence === scopeFence &&
      body.allowedScopes.includes(scope),
    [scope, scopeFence],
  );

  const invalidateRequests = useCallback(() => {
    generationRef.current += 1;
    headSeqRef.current += 1;
    pageAbortRef.current?.abort();
    pageAbortRef.current = null;
    headAbortRef.current?.abort();
    headAbortRef.current = null;
    pageInFlightRef.current = false;
    for (const field of LOOKUP_FIELDS) {
      lookupAbortRef.current[field]?.abort();
      lookupAbortRef.current[field] = null;
      const timer = lookupTimerRef.current[field];
      if (timer !== null) clearTimeout(timer);
      lookupTimerRef.current[field] = null;
      lookupSeqRef.current[field] += 1;
    }
  }, []);

  const commitError = useCallback(
    (next: ActivityFeedError | null, placement?: ActivityErrorPlacement) => {
      errorRef.current = next;
      setError(next);
      if (next !== null && placement) {
        setErrorPlacement(placement);
      }
    },
    [],
  );

  const clearView = useCallback(() => {
    setRows([]);
    setNextCursor(null);
    firstHeadRef.current = null;
    setFirstHeadState(null);
    setPendingNew(false);
  }, []);

  const denyAccess = useCallback(
    ({ announce }: { announce: boolean }) => {
      invalidateRequests();
      errorRef.current = "accessChanged";
      setRows([]);
      setNextCursor(null);
      firstHeadRef.current = null;
      setFirstHeadState(null);
      setOptions(null);
      setLookupOptions(EMPTY_LOOKUP_OPTIONS);
      setLookupError(EMPTY_LOOKUP_ERRORS);
      setPendingNew(false);
      setBusy(null);
      setError("accessChanged");
      setErrorPlacement("toolbar");
      if (announce) {
        setAlertTick((tick) => tick + 1);
      }
    },
    [invalidateRequests],
  );

  const applyCommittedError = useCallback(
    (
      key: ActivityFeedError,
      placement: ActivityErrorPlacement,
      { announce }: { announce: boolean },
    ) => {
      if (key === "accessChanged") {
        denyAccess({ announce });
        return;
      }
      commitError("loadFailed", placement);
      if (announce) {
        setAlertTick((tick) => tick + 1);
      }
    },
    [commitError, denyAccess],
  );

  const buildParams = useCallback(
    (
      view: "page" | "head" | "filters",
      applied: AppliedFilters,
      cursor?: string,
    ) => {
      const params = new URLSearchParams({ view, limit: String(PAGE_SIZE) });
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      if (applied.channel) params.set("channel", applied.channel);
      if (applied.category) params.set("category", applied.category);
      if (applied.kind) params.set("kind", applied.kind);
      if (applied.actor) params.set("actor", applied.actor);
      if (applied.allianceId) params.set("allianceId", applied.allianceId);
      if (applied.server) params.set("server", applied.server);
      if (cursor) params.set("cursor", cursor);
      return params;
    },
    [],
  );

  const beginExplicit = useCallback(() => {
    invalidateRequests();
    pageInFlightRef.current = true;
    const controller = new AbortController();
    pageAbortRef.current = controller;
    return { generation: generationRef.current, signal: controller.signal };
  }, [invalidateRequests]);

  const runLookup = useCallback(
    async (field: ActivityLookupField, query: string, explicit: boolean) => {
      if (
        blockedRef.current ||
        errorRef.current === "accessChanged" ||
        !filtersValidRef.current
      ) {
        return;
      }
      const seq = ++lookupSeqRef.current[field];
      lookupAbortRef.current[field]?.abort();
      const controller = new AbortController();
      lookupAbortRef.current[field] = controller;
      const generation = generationRef.current;
      try {
        const applied = { ...appliedRef.current };
        if (field === "actor") delete applied.actor;
        if (field === "alliance") delete applied.allianceId;
        if (field === "server") delete applied.server;
        const params = buildParams("filters", applied);
        const trimmed = query.trim();
        if (trimmed) params.set("q", trimmed);
        const body = await fetchJson<ActivityFeedOptionsResponse>(
          params,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          seq !== lookupSeqRef.current[field] ||
          generation !== generationRef.current
        ) {
          return;
        }
        if (!responseAllowed(body)) {
          denyAccess({ announce: explicit });
          return;
        }
        const next =
          field === "actor"
            ? body.options.actors
            : field === "alliance"
              ? body.options.alliances
              : body.options.servers;
        setAllowedScopes(knownActivityScopes(body.allowedScopes));
        setLookupOptions((prev) => ({ ...prev, [field]: next }));
        setLookupError((prev) => ({ ...prev, [field]: false }));
      } catch (err) {
        if (
          isAbortError(err) ||
          controller.signal.aborted ||
          seq !== lookupSeqRef.current[field]
        ) {
          return;
        }
        if (generation !== generationRef.current) return;
        if (
          err instanceof ActivityRequestError &&
          err.errorKey === "accessChanged"
        ) {
          denyAccess({ announce: explicit });
          return;
        }
        setLookupError((prev) => ({ ...prev, [field]: true }));
        if (explicit) {
          setLookupAlert((prev) => ({ ...prev, [field]: prev[field] + 1 }));
        }
      }
    },
    [buildParams, denyAccess, fetchJson, responseAllowed],
  );

  const searchLookup = useCallback(
    (field: ActivityLookupField, query: string) => {
      lookupQueryRef.current[field] = query;
      lookupSeqRef.current[field] += 1;
      lookupAbortRef.current[field]?.abort();
      lookupAbortRef.current[field] = null;
      const timer = lookupTimerRef.current[field];
      if (timer !== null) clearTimeout(timer);
      const skip = skipInitialLookupRef.current[field];
      skipInitialLookupRef.current[field] = false;
      if (
        (skip && !query.trim()) ||
        blockedRef.current ||
        errorRef.current === "accessChanged" ||
        !filtersValidRef.current
      ) {
        lookupTimerRef.current[field] = null;
        return;
      }
      lookupTimerRef.current[field] = setTimeout(() => {
        lookupTimerRef.current[field] = null;
        void runLookup(field, lookupQueryRef.current[field], true);
      }, LOOKUP_DEBOUNCE_MS);
    },
    [runLookup],
  );

  const retryLookup = useCallback(
    (field: ActivityLookupField) => {
      void runLookup(field, lookupQueryRef.current[field], true);
    },
    [runLookup],
  );

  const refreshLookups = useCallback(() => {
    const fields: ActivityLookupField[] =
      scope === "personal"
        ? ["alliance"]
        : scope === "alliance"
          ? ["actor"]
          : ["actor", "alliance", "server"];
    for (const field of fields) {
      const hasQuery = lookupQueryRef.current[field].trim() !== "";
      const hasActiveFilter =
        (field === "actor" && appliedRef.current.actor !== undefined) ||
        (field === "alliance" && appliedRef.current.allianceId !== undefined) ||
        (field === "server" && appliedRef.current.server !== undefined);
      if (!hasQuery && !hasActiveFilter) continue;
      void runLookup(field, lookupQueryRef.current[field], false);
    }
  }, [runLookup, scope]);

  const commitPage = useCallback(
    (page: ActivityFeedPage, optionsBody: ActivityFeedOptionsResponse) => {
      setRows(page.items);
      setNextCursor(page.nextCursor);
      firstHeadRef.current = page.head;
      setFirstHeadState(page.head);
      setOptions(optionsBody.options);
      setAllowedScopes(knownActivityScopes(page.allowedScopes));
      setLookupOptions({
        actor: optionsBody.options.actors,
        alliance: optionsBody.options.alliances,
        server: optionsBody.options.servers,
      });
      setLookupError(EMPTY_LOOKUP_ERRORS);
      setPendingNew(false);
      failedOpRef.current = null;
      commitError(null);
    },
    [commitError],
  );

  const loadFirstPage = useCallback(
    async (
      applied: AppliedFilters,
      kind: "filter" | "refresh" | "retry" | "viewNew" | "revalidate",
    ) => {
      const { generation, signal } = beginExplicit();
      appliedRef.current = applied;
      if (kind === "filter") {
        setRows([]);
      }
      setBusy(kind === "refresh" || kind === "viewNew" ? "refresh" : "first");
      try {
        const [page, optionsBody] = await Promise.all([
          fetchJson<ActivityFeedPage>(buildParams("page", applied), signal),
          fetchJson<ActivityFeedOptionsResponse>(
            buildParams("filters", applied),
            signal,
          ),
        ]);
        if (signal.aborted || generation !== generationRef.current) return;
        if (!responseAllowed(page) || !responseAllowed(optionsBody)) {
          denyAccess({ announce: true });
          return;
        }
        commitPage(page, optionsBody);
        refreshLookups();
      } catch (err) {
        if (isAbortError(err) || signal.aborted) return;
        if (generation !== generationRef.current) return;
        failedOpRef.current = { kind: "first" };
        applyCommittedError(
          err instanceof ActivityRequestError ? err.errorKey : "loadFailed",
          "toolbar",
          { announce: true },
        );
      } finally {
        if (generation === generationRef.current) {
          pageInFlightRef.current = false;
          setBusy(null);
        }
      }
    },
    [
      applyCommittedError,
      beginExplicit,
      buildParams,
      commitPage,
      denyAccess,
      fetchJson,
      refreshLookups,
      responseAllowed,
    ],
  );

  const runLoadMore = useCallback(
    async (cursor: string) => {
      if (!filtersValidRef.current) return;
      const { generation, signal } = beginExplicit();
      setBusy("more");
      try {
        const applied = appliedRef.current;
        const page = await fetchJson<ActivityFeedPage>(
          buildParams("page", applied, cursor),
          signal,
        );
        if (signal.aborted || generation !== generationRef.current) return;
        if (!responseAllowed(page)) {
          denyAccess({ announce: true });
          return;
        }
        setRows((prev) => mergeUnique(prev, page.items));
        setNextCursor(page.nextCursor);
        setAllowedScopes(knownActivityScopes(page.allowedScopes));
        failedOpRef.current = null;
        commitError(null);
      } catch (err) {
        if (isAbortError(err) || signal.aborted) return;
        if (generation !== generationRef.current) return;
        failedOpRef.current = { kind: "more", cursor };
        applyCommittedError(
          err instanceof ActivityRequestError ? err.errorKey : "loadFailed",
          "bottom",
          { announce: true },
        );
      } finally {
        if (generation === generationRef.current) {
          pageInFlightRef.current = false;
          setBusy(null);
        }
      }
    },
    [
      applyCommittedError,
      beginExplicit,
      buildParams,
      commitError,
      denyAccess,
      fetchJson,
      responseAllowed,
    ],
  );

  const toAppliedFilters = useCallback(
    (values: ActivityFilterValues): AppliedFilters | null => {
      const applied: AppliedFilters = {};
      if (values.channel) applied.channel = values.channel;
      if (values.kind) applied.kind = values.kind;
      if (values.category) applied.category = values.category;
      if (values.actor && scope !== "personal") applied.actor = values.actor;
      if (values.allianceId && scope !== "alliance")
        applied.allianceId = values.allianceId;
      if (values.server && scope === "global") applied.server = values.server;
      if (values.dateFrom && values.dateTo && values.dateFrom > values.dateTo) {
        return null;
      }
      try {
        if (values.dateFrom) {
          applied.from = activityDayStartIso(values.dateFrom, iana);
        }
        if (values.dateTo) {
          applied.to = activityDayStartIso(
            addCalendarDays(values.dateTo, 1),
            iana,
          );
        }
      } catch {
        return null;
      }
      return applied;
    },
    [iana, scope],
  );

  const commitInvalidFilters = useCallback(() => {
    filtersValidRef.current = false;
    clearView();
    setBusy(null);
    failedOpRef.current = null;
    commitError("loadFailed", "toolbar");
    setAlertTick((tick) => tick + 1);
  }, [clearView, commitError]);

  const setFilter = useCallback(
    (patch: Partial<ActivityFilterValues>) => {
      const next = { ...filtersRef.current, ...patch };
      filtersRef.current = next;
      setFilters(next);
      invalidateRequests();
      clearView();
      const applied = toAppliedFilters(next);
      filtersValidRef.current = applied !== null;
      if (applied === null) {
        setBusy(null);
        failedOpRef.current = null;
        commitError("loadFailed", "toolbar");
        setAlertTick((tick) => tick + 1);
        return;
      }
      commitError(null);
      void loadFirstPage(applied, "filter");
    },
    [
      clearView,
      commitError,
      invalidateRequests,
      loadFirstPage,
      toAppliedFilters,
    ],
  );

  const clearFilters = useCallback(() => {
    filtersValidRef.current = true;
    filtersRef.current = EMPTY_ACTIVITY_FILTERS;
    setFilters(EMPTY_ACTIVITY_FILTERS);
    for (const field of LOOKUP_FIELDS) {
      lookupQueryRef.current[field] = "";
    }
    invalidateRequests();
    clearView();
    commitError(null);
    void loadFirstPage({}, "filter");
  }, [clearView, commitError, invalidateRequests, loadFirstPage]);

  const revalidate = useCallback(
    (kind: "refresh" | "retry" | "viewNew" | "revalidate") => {
      invalidateRequests();
      const applied = toAppliedFilters(filtersRef.current);
      filtersValidRef.current = applied !== null;
      if (applied === null) {
        commitInvalidFilters();
        return;
      }
      commitError(null);
      void loadFirstPage(applied, kind);
    },
    [
      commitError,
      commitInvalidFilters,
      invalidateRequests,
      loadFirstPage,
      toAppliedFilters,
    ],
  );

  const refresh = useCallback(() => {
    revalidate("refresh");
  }, [revalidate]);

  const retry = useCallback(() => {
    const failed = failedOpRef.current;
    if (failed?.kind === "more") {
      failedOpRef.current = null;
      commitError(null);
      void runLoadMore(failed.cursor);
      return;
    }
    revalidate("retry");
  }, [commitError, revalidate, runLoadMore]);

  const viewNew = useCallback(() => {
    revalidate("viewNew");
  }, [revalidate]);

  const loadMore = useCallback(() => {
    if (
      pageInFlightRef.current ||
      blockedRef.current ||
      errorRef.current === "accessChanged" ||
      !filtersValidRef.current ||
      !nextCursor
    ) {
      return;
    }
    void runLoadMore(nextCursor);
  }, [nextCursor, runLoadMore]);

  useEffect(() => {
    if (mountedRef.current) return;
    if (initial !== null || initialError !== null) {
      mountedRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      if (mountedRef.current) return;
      mountedRef.current = true;
      revalidate("revalidate");
    }, 0);
    return () => clearTimeout(timer);
  }, [initial, initialError, revalidate]);

  const [wasBlocked, setWasBlocked] = useState(blocked);
  if (blocked !== wasBlocked) {
    setWasBlocked(blocked);
    setRows([]);
    setNextCursor(null);
    setFirstHeadState(null);
    setOptions(null);
    setLookupOptions(EMPTY_LOOKUP_OPTIONS);
    setLookupError(EMPTY_LOOKUP_ERRORS);
    setPendingNew(false);
    setError(null);
    setBusy("first");
  }

  const everBlockedRef = useRef(false);
  useEffect(() => {
    blockedRef.current = blocked;
    if (!blocked && !everBlockedRef.current) return;
    errorRef.current = null;
    invalidateRequests();
    if (blocked) {
      everBlockedRef.current = true;
      firstHeadRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      revalidate("revalidate");
    }, 0);
    return () => clearTimeout(timer);
  }, [blocked, invalidateRequests, revalidate]);

  useEffect(() => {
    if (prevIanaRef.current === iana) return;
    prevIanaRef.current = iana;
    if (!filtersRef.current.dateFrom && !filtersRef.current.dateTo) return;
    invalidateRequests();
    clearView();
    const applied = toAppliedFilters(filtersRef.current);
    filtersValidRef.current = applied !== null;
    if (applied === null) {
      setBusy(null);
      commitError("loadFailed", "toolbar");
      return;
    }
    commitError(null);
    void loadFirstPage(applied, "filter");
  }, [
    clearView,
    commitError,
    iana,
    invalidateRequests,
    loadFirstPage,
    toAppliedFilters,
  ]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (
        cancelled ||
        document.hidden ||
        blockedRef.current ||
        errorRef.current === "accessChanged" ||
        !filtersValidRef.current ||
        pageInFlightRef.current
      ) {
        return;
      }
      const applied = toAppliedFilters(filtersRef.current);
      if (applied === null) {
        return;
      }
      headAbortRef.current?.abort();
      const controller = new AbortController();
      headAbortRef.current = controller;
      const headSeq = ++headSeqRef.current;
      const generation = generationRef.current;
      try {
        const body = await fetchJson<{
          head: ActivityFeedPage["head"];
          scope: string;
          scopeFence: string;
          allowedScopes: ActivityFeedScope[];
        }>(buildParams("head", applied), controller.signal);
        if (
          cancelled ||
          controller.signal.aborted ||
          headSeq !== headSeqRef.current ||
          generation !== generationRef.current
        ) {
          return;
        }
        if (!responseAllowed(body)) {
          denyAccess({ announce: false });
          return;
        }
        setAllowedScopes(knownActivityScopes(body.allowedScopes));
        if (!headsEqual(body.head, firstHeadRef.current)) {
          setPendingNew(true);
        }
        if (
          errorRef.current === "loadFailed" &&
          failedOpRef.current === null
        ) {
          commitError(null);
        }
      } catch (err) {
        if (
          isAbortError(err) ||
          cancelled ||
          headSeq !== headSeqRef.current ||
          generation !== generationRef.current
        ) {
          return;
        }
        if (
          err instanceof ActivityRequestError &&
          err.errorKey === "accessChanged"
        ) {
          denyAccess({ announce: false });
          return;
        }
        commitError("loadFailed", "toolbar");
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, POLL_MS);
    const onFocus = () => void poll();
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      headAbortRef.current?.abort();
    };
  }, [
    buildParams,
    commitError,
    denyAccess,
    fetchJson,
    responseAllowed,
    toAppliedFilters,
  ]);

  useEffect(() => invalidateRequests, [invalidateRequests]);

  const filtersActive = useMemo(
    () => Object.values(filters).some((value) => value !== ""),
    [filters],
  );

  return {
    rows,
    nextCursor,
    firstHead,
    options,
    allowedScopes,
    error,
    errorPlacement,
    busy,
    blocked,
    pendingNew,
    filters,
    filtersActive,
    setFilter,
    clearFilters,
    refresh,
    retry,
    viewNew,
    loadMore,
    lookupOptions,
    lookupError,
    lookupAlert,
    searchLookup,
    retryLookup,
    alertTick,
  };
}
